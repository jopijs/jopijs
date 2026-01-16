
import * as jk_app from "jopi-toolkit/jk_app";
import { makeIterable } from "../internalTools.js";
import { ONE_MEGA_OCTET as oneMo } from "../publicTools.js";
import type { ObjectCache, ObjectCacheEntry, ObjectCacheMeta } from "./def.ts";
import { runGarbageCollector } from "../cacheHtml/garbageCollector.js";

const keepOnHotReload = jk_app.keepOnHotReload;
const HOT_RELOAD_KEY = "jopi.rewrite.inMemoryObjectCache.hotReloadKey";

export interface InMemoryObjectCacheOptions {
    clearOnHotReload?: boolean;
    maxItemCount?: number;
    maxItemCountDelta?: number;
    maxMemoryUsage_mo?: number;
    maxMemoryUsageDelta_mo?: number;
}

interface MyCacheEntry extends ObjectCacheEntry {
    valueSize: number;
    _refCount: number;
    _refCountSinceGC: number;
}

export class InMemoryObjectCache implements ObjectCache {
    private readonly subCaches: Record<string, InMemorySubObjectCache> = {};

    createSubCache(name: string): ObjectCache {
        let cache = this.subCaches[name];
        
        if (!cache) {
            cache = new InMemorySubObjectCache(this, name);
            this.subCaches[name] = cache;
        }

        return cache;
    }

    private readonly cache = keepOnHotReload(HOT_RELOAD_KEY, () => new Map<string, MyCacheEntry>());

    private statItemCount = 0;
    private readonly maxItemCount: number;
    private readonly maxItemCountDelta: number;

    private statMemoryUsage = 0;
    private readonly maxMemoryUsage: number;
    private readonly maxMemoryUsageDelta: number;

    constructor(options?: InMemoryObjectCacheOptions) {
        options = options || {};

        if (!options.maxItemCount) options.maxItemCount = 5000;
        if (!options.maxItemCountDelta) options.maxItemCountDelta = Math.trunc(options.maxItemCount * 0.1);

        if (!options.maxMemoryUsage_mo) options.maxMemoryUsage_mo = 500;
        if (!options.maxMemoryUsageDelta_mo) options.maxMemoryUsageDelta_mo = Math.trunc(options.maxMemoryUsage_mo * 0.1);

        this.maxItemCount = options.maxItemCount!;
        this.maxItemCountDelta = options.maxItemCountDelta!;

        this.maxMemoryUsage = Math.trunc(options.maxMemoryUsage_mo * oneMo);
        this.maxMemoryUsageDelta = Math.trunc(options.maxMemoryUsageDelta_mo! * oneMo);
    }

    async set<T>(key: string, value: T, meta?: ObjectCacheMeta): Promise<void> {
        return this.key_set("", key, value, meta);
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
        const iterator = this.cache.keys();

        return makeIterable({
            next(): IteratorResult<string> {
                while (true) {
                    let result = iterator.next();
                    if (result.done) return { value: undefined, done: true };

                    let key = result.value;
                    let idx = key.indexOf(":");

                    // Only return keys that are NOT in a subcache
                    if (idx === -1) {
                         return { value: key, done: false };
                    }
                }
            }
        });
    }

    getSubCacheIterator(): Iterable<string> {
        return this.sub_getSubCacheIterator("");
    }

    //region SubCache Iterator Helpers

    sub_keys(prefix: string): Iterable<string> {
        const iterator = this.cache.keys();
        const prefixLen = prefix.length;

        return makeIterable({
            next(): IteratorResult<string> {
                while (true) {
                    let result = iterator.next();
                    if (result.done) return { value: undefined, done: true };

                    let key = result.value;
                    
                    if (key.startsWith(prefix)) {
                        return { value: key.substring(prefixLen), done: false };
                    }
                }
            }
        });
    }

    sub_getSubCacheIterator(prefix: string): Iterable<string> {
        const keys = Object.keys(this.subCaches);
        const prefixLen = prefix.length;
        let index = 0;

        return makeIterable({
            next(): IteratorResult<string> {
                while (index < keys.length) {
                    const key = keys[index++];
                    
                    if (key.startsWith(prefix)) {
                        const remaining = key.substring(prefixLen);
                        const idx = remaining.indexOf(":");
                        
                        // Direct child only (not A:B from prefix "")
                        // But also not "" (which would be the cache itself if listed?)
                        // If prefix is "A:", key "A:B" -> remaining "B". idx = -1. OK.
                        // Key "A:B:C" -> remaining "B:C". idx = 1. Skip.
                        if (remaining.length > 0 && idx === -1) {
                            return { value: remaining, done: false };
                        }
                    }
                }
                return { value: undefined, done: true };
            }
        });
    }

    //endregion

    //region Key Access

    async key_has(key: string): Promise<boolean> {
        const cacheEntry = this.cache.get(key);
        return !!cacheEntry;
    }

    async key_get<T>(key: string): Promise<T | undefined> {
        const entry = this.key_getValueFromCache(key);
        return entry ? entry.value : undefined;
    }

    async key_getWithMeta<T>(key: string): Promise<{ value: T; meta: ObjectCacheMeta } | undefined> {
        const entry = this.key_getValueFromCache(key);
        if (!entry) return undefined;
        return { value: entry.value, meta: entry.meta };
    }

    async key_set<T>(subCacheName: string, key: string, value: T, meta: ObjectCacheMeta | undefined) {
        if (!meta) meta = {};
        if (!meta.addedDate) meta.addedDate = Date.now();

        const fullKey = subCacheName ? subCacheName + key : key;
        const valueSize = this.estimateSize(value);

        const cacheEntry: MyCacheEntry = {
            key: fullKey,
            value,
            meta,
            valueSize,
            _refCount: 1,
            _refCountSinceGC: 1
        };

        this.statMemoryUsage += valueSize;
        this.cache.set(fullKey, cacheEntry);
        this.statItemCount++;

        if (this.needToGC()) {
            this.garbageCollector();
        }
    }

    async key_delete(key: string): Promise<void> {
        const cacheEntry = this.cache.get(key);

        if (cacheEntry) {
            this.statItemCount--;
            this.statMemoryUsage -= cacheEntry.valueSize;
            this.cache.delete(key);
        }
    }

    private key_getValueFromCache(key: string): MyCacheEntry | undefined {
        const cacheEntry = this.cache.get(key);
        if (!cacheEntry) return undefined;

        cacheEntry._refCount++;
        cacheEntry._refCountSinceGC++;

        return cacheEntry;
    }

    private estimateSize(value: any): number {
        if (value === undefined || value === null) return 0;
        if (typeof value === 'string') return value.length * 2;
        if (typeof value === 'number') return 8;
        if (typeof value === 'boolean') return 4;
        if (value instanceof Uint8Array) return value.byteLength;
        try {
            return JSON.stringify(value).length * 2;
        } catch {
            return 100;
        }
    }

    //endregion

    //region Garbage collector

    private needToGC() {
        if (this.statItemCount > this.maxItemCount) return true;
        else if (this.statMemoryUsage > this.maxMemoryUsage) return true;
        return false;
    }

    private garbageCollector() {
        runGarbageCollector({
            cache: this.cache,
            currentItemCount: this.statItemCount,
            currentMemoryUsage: this.statMemoryUsage,
            maxItemCount: this.maxItemCount,
            maxItemCountDelta: this.maxItemCountDelta,
            maxMemoryUsage: this.maxMemoryUsage,
            maxMemoryUsageDelta: this.maxMemoryUsageDelta,
            getEntrySize: (entry) => entry.valueSize,
            onEntryRemoved: (key, entry) => {
                this.statItemCount--;
                this.statMemoryUsage -= entry.valueSize;
                // console.log("|->  ... gc has removed object " + key);
            }
        });
    }

    //endregion
}

class InMemorySubObjectCache implements ObjectCache {
    private readonly prefix: string;

    constructor(private readonly parent: InMemoryObjectCache, name: string) {
        this.prefix = name + ":";
    }

    createSubCache(name: string): ObjectCache {
        return this.parent.createSubCache(this.prefix + name); // Chained subcaches?
        // Note: The InMemoryCache implementation flattens subcaches in the map with "name:".
        // Here if we want recursive subcaches, we should be careful.
        // The previous implementation of InMemoryCache:
        // createSubCache(name) => new InMemorySubCache(this, name) where prefix = name + ":"
        // SubCache.createSubCache(name) => parent.createSubCache(name) ?? No.
        // In PageCache implementation:
        // class InMemorySubCache {
        //    createSubCache(name: string): PageCache {
        //        return this.parent.createSubCache(name);
        //    }
        // }
        // This implies subcaches are flat in PageCache (siblings, not children).
        // Let's stick to flat for now unless requested otherwise.
    }

    async get<T>(key: string): Promise<T | undefined> {
        return this.parent.key_get(this.prefix + key);
    }

    async getWithMeta<T>(key: string): Promise<{ value: T; meta: ObjectCacheMeta } | undefined> {
        return this.parent.key_getWithMeta(this.prefix + key);
    }

    async set<T>(key: string, value: T, meta?: ObjectCacheMeta): Promise<void> {
        return this.parent.key_set(this.prefix, key, value, meta);
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
        return this.parent.sub_getSubCacheIterator(this.prefix);
    }
}

export function initMemoryObjectCache(options: InMemoryObjectCacheOptions) {
    if (gInstance) return;
    gInstance = new InMemoryObjectCache(options);
}

export function getInMemoryObjectCache(): ObjectCache {
    if (!gInstance) initMemoryObjectCache({});
    return gInstance;
}

let gInstance: InMemoryObjectCache;
