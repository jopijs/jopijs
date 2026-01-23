import * as jk_crypto from "jopi-toolkit/jk_crypto";
import * as jk_compress from "jopi-toolkit/jk_compress";
import { JkMemCache } from "jopi-toolkit/jk_memcache";
import { getSharedJkMemCache } from "../sharedJkMemCache.ts";

import type {CacheMeta, PageCache, CacheEntry, CacheItemProps} from "./cache.ts";
import {ONE_KILO_OCTET, ONE_MEGA_OCTET} from "../publicTools.ts";
import {
    cacheAddBrowserCacheValues,
    cacheItemToResponse,
    makeIterable,
    readContentLength
} from "../internalTools.ts";
import type {JopiRequest} from "../jopiRequest.ts";

const GLOBAL_PREFIX = "HTML:";

export interface InMemoryCacheOptions {
    clearOnHotReload?: boolean;
    maxContentLength?: number;
    maxItemCount?: number;
    maxMemoryUsage_mo?: number;
}

/**
 * Metadata stored alongside the binary content in JkMemCache.
 */
interface StoredCacheMeta {
    url: string;
    isGzipped?: boolean;
    headers?: {[key:string]: string};
    status?: number;
    meta?: CacheMeta;
}

export class InMemoryCache implements PageCache {
    private readonly subCaches: Record<string, InMemorySubCache> = {};
    private gzipMaxSize = 20 * ONE_MEGA_OCTET;
    private readonly maxContentLength: number;

    private _cache: JkMemCache;

    constructor(options?: InMemoryCacheOptions) {
        options = options || {};

        const maxContentLength = options.maxContentLength || ONE_KILO_OCTET * 600;
        this.maxContentLength = maxContentLength;

        this._cache = getSharedJkMemCache({
            maxItemCount: options.maxItemCount,
            maxMemoryUsage_mo: options.maxMemoryUsage_mo
        });
    }

    createSubCache(name: string): PageCache {
        let cache = this.subCaches[name];
        
        if (!cache) {
            cache = new InMemorySubCache(this, name);
            this.subCaches[name] = cache;
        }

        return cache;
    }

    async addToCache(_req: JopiRequest, url: URL, response: Response, meta?: CacheMeta): Promise<Response> {
        return this.key_addToCache("", url.toString(), response, meta);
    }

    async removeFromCache(url: URL): Promise<void> {
        await this.key_removeFromCache(url.toString());

        for (let subCache of Object.values(this.subCaches)) {
            await subCache.removeFromCache(url);
        }
    }

    async getFromCache(req: JopiRequest, url: URL): Promise<Response|undefined> {
        return this.key_getFromCache(req, url.href);
    }

    async getFromCacheWithMeta(req: JopiRequest, url: URL): Promise<CacheEntry | undefined> {
        return this.key_getFromCacheWithMeta(req, url.href);
    }

    getCacheMeta(url: URL): Promise<CacheMeta | undefined> {
        return this.key_getCacheMeta(url.href);
    }

    async hasInCache(url: URL): Promise<boolean> {
        return this.key_hasInCache(url.href);
    }

    async getCacheEntrySize(url: URL): Promise<number | undefined> {
        return this.key_getCacheEntrySize(url.href);
    }

    /**
     * Set the binary value inside the cache entry.
     * This by compressing the binary if needed.
     */
    private async prepareBinary(response: Response): Promise<{ binary: Uint8Array, isGzipped: boolean }> {
        const asBinary = new Uint8Array(await response.arrayBuffer());
        const byteLength = asBinary.byteLength;
        const canCompress = byteLength < this.gzipMaxSize;

        if (!canCompress) {
            return { binary: asBinary, isGzipped: false };
        }

        const bufferGzip = jk_compress.gzipSync(asBinary);
        return { binary: new Uint8Array(bufferGzip.buffer as ArrayBuffer), isGzipped: true };
    }

    getCacheEntryIterator(subCacheName?: string): Iterable<CacheEntry> {
        // convention: subCacheName + ":" + url
        const userPrefix = subCacheName ? subCacheName + ":" : "";
        const fullPrefix = GLOBAL_PREFIX + userPrefix;
        
        const iterator = this._cache.keysStartingWith(fullPrefix);
        const that = this;

        return makeIterable({
            next(): IteratorResult<CacheEntry> {
                while (true) {
                    const res = iterator.next();
                    if (res.done) return { value: undefined, done: true };
                    
                    const vEntry = that._cache.getWithMeta<Uint8Array>(res.value, true);
                    if (!vEntry) continue;
                    
                    const storedMeta = vEntry.meta as StoredCacheMeta;

                    return {
                        value: {
                            url: storedMeta.url,
                            meta: storedMeta.meta,
                            response: that.reconstructResponse(vEntry.value, storedMeta)
                        },
                        done: false
                    };
                }
            }
        });
    }

    getSubCacheIterator(): Iterable<string> {
        const alreadyReturned = new Set<string>();
        const iterator = this._cache.keysStartingWith(GLOBAL_PREFIX);
        const prefixLen = GLOBAL_PREFIX.length;

        return makeIterable({
            next(): IteratorResult<string> {
                while (true) {
                     const res = iterator.next();
                     if (res.done) return { value: undefined, done: true };
                     
                     const fullKey = res.value;
                     const key = fullKey.substring(prefixLen);
                     
                     // Convention: "SubCache:url"
                     const separatorIdx = key.indexOf(":");
                     if (separatorIdx===-1) continue;
                     
                     const subCacheName = key.substring(0, separatorIdx + 1);
                     if (subCacheName === "http:" || subCacheName === "https:") continue;

                     if (!alreadyReturned.has(subCacheName)) {
                         alreadyReturned.add(subCacheName);
                         return { value: subCacheName, done: false };
                     }
                }
            }
        });
    }

    //region With a key

    async key_hasInCache(key: string): Promise<boolean> {
        return this._cache.has(GLOBAL_PREFIX + key);
    }

    async key_getCacheMeta(key: string): Promise<CacheMeta | undefined> {
        const entry = this._cache.getWithMeta(GLOBAL_PREFIX + key);
        if (!entry) return undefined;
        return (entry.meta as StoredCacheMeta).meta;
    }

    async key_getCacheEntrySize(key: string): Promise<number | undefined> {
        const entry = this._cache.getWithMeta<Uint8Array>(GLOBAL_PREFIX + key);
        if (!entry) return undefined;
        return entry.size;
    }

    async key_addToCache(subCacheName: string, url: string, response: Response, meta: CacheMeta|undefined) {
        if ((response.status !== 200) || (!response.body)) {
            return response;
        }
       
        const contentLength = readContentLength(response.headers);
        if (contentLength > this.maxContentLength) return response;

        const { binary, isGzipped } = await this.prepareBinary(response);

        // Reconstruct basic headers/props
        const headers: {[key: string]: string} = {};
        response.headers.forEach((v, k) => headers[k] = v);

        const etag = jk_crypto.fastHash(binary);
        cacheAddBrowserCacheValues(headers, etag);
        
        // Prepare meta for storage
        const storedMeta: StoredCacheMeta = {
            url,
            isGzipped,
            headers,
            status: response.status,
            meta: meta || {}
        };

        const key = GLOBAL_PREFIX + subCacheName + url;
        
        // Allows keeping HTML in cache longer than other types of content.
        //
        let importance = 1;
        if (headers["content-type"]?.startsWith("text/html")) importance = 10;
        
        this._cache.set(key, binary, { importance, meta: storedMeta });
        
        // Return a fresh response from the stored data.
        return this.reconstructResponse(binary, storedMeta);
    }

    key_removeFromCache(key: string): Promise<void> {
        this._cache.delete(GLOBAL_PREFIX + key);
        return Promise.resolve();
    }

    key_getFromCache(req: JopiRequest, key: string): Response|undefined {
        const entry = this._cache.getWithMeta<Uint8Array>(GLOBAL_PREFIX + key);
        if (!entry) return undefined;
        
        const storedMeta = entry.meta as StoredCacheMeta;
        
        // Validate headers (304 Not Modified etc)
        let cacheRes = req.file_validateCacheHeadersWith(storedMeta.headers || {});
        if (cacheRes) return cacheRes;

        return this.reconstructResponse(entry.value, storedMeta);
    }

    key_getFromCacheWithMeta(req: JopiRequest, key: string): CacheEntry | undefined {
        const entry = this._cache.getWithMeta<Uint8Array>(GLOBAL_PREFIX + key);
        if (!entry) return undefined;

        const storedMeta = entry.meta as StoredCacheMeta;
        
        let cacheRes = req.file_validateCacheHeadersWith(storedMeta.headers || {});
        const response = cacheRes || this.reconstructResponse(entry.value, storedMeta);
        
        return {
            url: storedMeta.url,
            response,
            meta: storedMeta.meta
        };
    }

    private reconstructResponse(binary: Uint8Array, meta: StoredCacheMeta): Response {
       const item: CacheItemProps = {
           url: meta.url,
           binary: binary as any,
           binarySize: binary.byteLength,
           isGzipped: meta.isGzipped,
           headers: meta.headers,
           status: meta.status,
           meta: meta.meta || {}
       };
       
       return cacheItemToResponse(item);
    }
    
    //endregion
}

class InMemorySubCache implements PageCache {
    private readonly prefix: string;

    constructor(private readonly parent: InMemoryCache, name: string) {
        this.prefix = name + ":";
    }

    async addToCache(_req: JopiRequest, url: URL, response: Response, meta?: CacheMeta): Promise<Response> {
        return this.parent.key_addToCache(this.prefix, url.href, response, meta);
    }

    async hasInCache(url: URL): Promise<boolean> {
        return this.parent.key_hasInCache(this.prefix + url.href);
    }

    async getCacheEntrySize(url: URL): Promise<number | undefined> {
        return this.parent.key_getCacheEntrySize(this.prefix + url.href);
    }


    async getCacheMeta(url: URL): Promise<CacheMeta | undefined> {
        return this.parent.key_getCacheMeta(this.prefix + url.href);
    }

    removeFromCache(url: URL): Promise<void> {
        return this.parent.key_removeFromCache(this.prefix + url.href);
    }

    async getFromCache(req: JopiRequest, url: URL): Promise<Response|undefined> {
        return this.parent.key_getFromCache(req, this.prefix + url.href);
    }

    async getFromCacheWithMeta(req: JopiRequest, url: URL): Promise<CacheEntry | undefined> {
        return this.parent.key_getFromCacheWithMeta(req, this.prefix + url.href);
    }

    createSubCache(name: string): PageCache {
        return this.parent.createSubCache(name);
    }

    getCacheEntryIterator(subCacheName?: string) {
        return this.parent.getCacheEntryIterator(subCacheName);
    }

    getSubCacheIterator() {
        return this.parent.getSubCacheIterator();
    }
}

export function initMemoryCache(options: InMemoryCacheOptions) {
    if (gInstance) return;
    gInstance = new InMemoryCache(options);
}

export function getInMemoryCache(): PageCache {
    if (!gInstance) initMemoryCache({});
    return gInstance;
}

let gInstance: InMemoryCache;