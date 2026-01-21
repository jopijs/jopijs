
import { makeIterable } from "../internalTools.js";
import type { ObjectCache, ObjectCacheMeta, ObjectCacheSetParams } from "./interfaces.ts";
import { JkMemCache } from "jopi-toolkit/jk_memcache";
import { getSharedJkMemCache } from "../sharedJkMemCache.js";

const GLOBAL_PREFIX = "OBJ:";

export interface InMemoryObjectCacheOptions {
    clearOnHotReload?: boolean;
    maxItemCount?: number;
    maxMemoryUsage_mo?: number;
}

export class MemoryStore implements ObjectCache {
    private readonly subCaches: Record<string, InMemorySubObjectCache> = {};
    private _cache: JkMemCache;
    
    constructor(options?: InMemoryObjectCacheOptions) {
        options = options || {};

        // Use shared cache instance
        this._cache = getSharedJkMemCache({
            maxItemCount: options.maxItemCount,
            maxMemoryUsage_mo: options.maxMemoryUsage_mo
        });
    }

    createSubCache(name: string): ObjectCache {
        let cache = this.subCaches[name];
        
        if (!cache) {
            cache = new InMemorySubObjectCache(this, name);
            this.subCaches[name] = cache;
        }

        return cache;
    }

    async set<T>(key: string, value: T, params?: ObjectCacheSetParams): Promise<void> {
        return this.key_set("", key, value, params);
    }

    async delete(key: string): Promise<void> {
        await this.key_delete(key);

        for (let subCache of Object.values(this.subCaches)) {
            await subCache.delete(key);
        }
    }

    async get<T>(key: string): Promise<T | undefined> {
        return this.key_get(key);
    }

    async getWithMeta<T>(key: string): Promise<{ value: T; meta: ObjectCacheMeta } | undefined> {
        return this.key_getWithMeta(key);
    }

    async has(key: string): Promise<boolean> {
        return this.key_has(key);
    }

    keys(): Iterable<string> {
       const iterator = this._cache.keysStartingWith(GLOBAL_PREFIX);
       const prefixLen = GLOBAL_PREFIX.length;
       
       return makeIterable({
            next(): IteratorResult<string> {
                while (true) {
                    const res = iterator.next();
                    if (res.done) return { value: undefined, done: true };
                    
                    const fullKey = res.value;
                    const key = fullKey.substring(prefixLen);
                    
                    // We only want top-level keys here (no colon separators for subcaches)
                    if (key.indexOf(":") === -1) {
                        return { value: key, done: false };
                    }
                }
            }
       });
    }

    getSubCacheIterator(): Iterable<string> {
        return Object.keys(this.subCaches);
    }

    //region SubCache Helpers logic

    sub_keys(prefix: string): Iterable<string> {
        const fullPrefix = GLOBAL_PREFIX + prefix;
        const iterator = this._cache.keysStartingWith(fullPrefix);
        const prefixLen = fullPrefix.length;

        return makeIterable({
            next(): IteratorResult<string> {
                const res = iterator.next();
                if (res.done) return { value: undefined, done: true };
                return { value: res.value.substring(prefixLen), done: false };
            }
        });
    }

    //endregion

    //region Key Access (Internal)

    async key_has(key: string): Promise<boolean> {
        return this._cache.has(GLOBAL_PREFIX + key);
    }

    async key_get<T>(key: string): Promise<T | undefined> {
        return this._cache.get<T>(GLOBAL_PREFIX + key) || undefined;
    }

    async key_getWithMeta<T>(key: string): Promise<{ value: T; meta: ObjectCacheMeta } | undefined> {
        const entry = this._cache.getWithMeta<T>(GLOBAL_PREFIX + key);
        if (!entry) return undefined;
        return { value: entry.value, meta: entry.meta as ObjectCacheMeta };
    }

    async key_set<T>(subCacheName: string, key: string, value: T, params?: ObjectCacheSetParams) {
        if (!params) params = {};
        const meta = params.meta || {};

        const userKey = subCacheName ? subCacheName + key : key;
        const fullKey = GLOBAL_PREFIX + userKey;
        
        // Prepare options for JkMemCache
        const opts: any = {};
        if (params.ttl) opts.ttl = params.ttl;
        if (params.expireAt) opts.expiresAt = params.expireAt;
        if (params.importance) opts.importance = params.importance;
        
        // Pass meta directly to JkMemCache
        if (Object.keys(meta).length > 0) {
            opts.meta = meta;
        }

        // We do not need to check max entries/memory here, JkMemCache handles usage.
        this._cache.set(fullKey, value as any, opts);
    }

    async key_delete(key: string): Promise<void> {
        this._cache.delete(GLOBAL_PREFIX + key);
    }
    
    //endregion
}

class InMemorySubObjectCache implements ObjectCache {
    private readonly prefix: string;

    constructor(private readonly parent: MemoryStore, name: string) {
        this.prefix = name + ":";
    }

    private readonly subCaches: Record<string, ObjectCache> = {};

    createSubCache(name: string): ObjectCache {
        return this.parent.createSubCache(name);
    }

    async get<T>(key: string): Promise<T | undefined> {
        return this.parent.key_get(this.prefix + key);
    }

    async getWithMeta<T>(key: string): Promise<{ value: T; meta: ObjectCacheMeta } | undefined> {
        return this.parent.key_getWithMeta(this.prefix + key);
    }

    async set<T>(key: string, value: T, params?: ObjectCacheSetParams): Promise<void> {
        // Note: passing prefix as subCacheName
        return this.parent.key_set(this.prefix, key, value, params);
    }

    async delete(key: string): Promise<void> {
        return this.parent.key_delete(this.prefix + key);
    }

    async has(key: string): Promise<boolean> {
        return this.parent.key_has(this.prefix + key);
    }

    keys(): Iterable<string> {
        return this.parent.sub_keys(this.prefix);
    }

    getSubCacheIterator(): Iterable<string> {
        return this.parent.getSubCacheIterator();
    }
}

export function initMemoryObjectCache(options: InMemoryObjectCacheOptions) {
    if (gInstance) return;
    gInstance = new MemoryStore(options);
}

export function getInMemoryObjectCache(): ObjectCache {
    if (!gInstance) initMemoryObjectCache({});
    return gInstance;
}

let gInstance: MemoryStore;
