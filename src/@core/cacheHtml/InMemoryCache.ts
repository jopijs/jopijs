import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_crypto from "jopi-toolkit/jk_crypto";
import * as jk_compress from "jopi-toolkit/jk_compress";
import { JkMemCache } from "jopi-toolkit/jk_memcache";

import type {CacheMeta, PageCache, CacheEntry, CacheItemProps} from "./cache.ts";
import {ONE_KILO_OCTET, ONE_MEGA_OCTET} from "../publicTools.ts";
import {
    cacheAddBrowserCacheValues,
    cacheItemToResponse,
    makeIterable,
    readContentLength
} from "../internalTools.ts";
import type {JopiRequest} from "../jopiRequest.ts";

const clearHotReloadKey = jk_app.clearHotReloadKey;
const keepOnHotReload = jk_app.keepOnHotReload;
const HOT_RELOAD_KEY = "jopi.rewrite.inMemoryCache.hotReloadKey";

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

        if (options.clearOnHotReload) {
            clearHotReloadKey(HOT_RELOAD_KEY);
        }

        const maxContentLength = options.maxContentLength || ONE_KILO_OCTET * 600;
        this.maxContentLength = maxContentLength;

        this._cache = keepOnHotReload(HOT_RELOAD_KEY, () => {
            const maxCount = options.maxItemCount || 5000;
            const maxMemoryUsage_mo = options.maxMemoryUsage_mo || 500;
            const maxSize = Math.trunc(maxMemoryUsage_mo * ONE_MEGA_OCTET);

            return new JkMemCache({
                name: "HtmlCache",
                maxCount,
                maxSize,
                cleanupInterval: 60000
            });
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
        return this.key_getFromCache(req, ':' + url.href);
    }

    async getFromCacheWithMeta(req: JopiRequest, url: URL): Promise<CacheEntry | undefined> {
        return this.key_getFromCacheWithMeta(req, ':' + url.href);
    }

    getCacheMeta(url: URL): Promise<CacheMeta | undefined> {
        return this.key_getCacheMeta(':' + url.href);
    }

    async hasInCache(url: URL): Promise<boolean> {
        return this.key_hasInCache(':' + url.href);
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
        const iterator = this._cache.keys();
        if (!subCacheName) subCacheName = "";
        const that = this;

        /*
            Keys logic:
            key_addToCache(subCacheName, url) -> key = subCacheName + ":" + url
            if subCacheName="API : " -> key = "API : :url"
            
            We iterate keys. We check if key starts with prefix.
            Wait, we need to extract the entry to build CacheEntry.
        */

        return makeIterable({
            next(): IteratorResult<CacheEntry> {
                while (true) {
                    const res = iterator.next();
                    if (res.done) return { value: undefined, done: true };
                    
                    const key = res.value;
                    let vEntry = that._cache.getWithMeta<Uint8Array>(key);
                    if (!vEntry) continue; // Should not happen unless expired between key and get
                    
                    const storedMeta = vEntry.meta as StoredCacheMeta;
                    if (!storedMeta) continue; // Should not happen
                    
                    const url = storedMeta.url;
                    
                    // Check subcache filter
                    // We need to parse the key or check the url? 
                    // Url in meta is just the url suffix.
                    // The key contains the subcache prefix.
                    
                    // Logic from old iterator:
                    /*
                        let vUrl = result.value[0]; // key
                        let idx = vUrl.indexOf(":");
                        if (subCacheName === vUrl.substring(0, idx)) {
                            // match
                        }
                    */

                    const idx = key.indexOf(":");
                    const currentSubCacheName = key.substring(0, idx);

                    if (subCacheName === currentSubCacheName) {
                         const cacheEntry: CacheEntry = {
                            url: url,
                            meta: storedMeta.meta,
                            response: that.reconstructResponse(vEntry.value, storedMeta)
                        };
                        return { value: cacheEntry, done: false };
                    }
                }
            }
        });
    }

    getSubCacheIterator(): Iterable<string> {
        // Since we don't maintain a list of dynamic subcaches in memory anymore (we only have the ones created via createSubCache in `this.subCaches`),
        // we could just return `Object.keys(this.subCaches)`.
        // However, the original implementation iterated over ALL keys in the cache to find prefixes.
        // This implies that if a subcache was populated, then the app restarted (hot reload kept cache), 
        // we might want to recover known subcaches?
        // But `subCaches` property is initialized empty on restart unless hot reload logic handles it?
        // `InMemoryCache` hot reload key handles the MAP. 
        // `subCaches` is NOT preserved in hot reload in the original code.
        // BUT `getSubCacheIterator` scanned the MAP. So it dynamically found subcaches present in data.
        
        // We can replicate scanning keys.
        const alreadyReturned = new Set<string>();
        const iterator = this._cache.keys();

        return makeIterable({
            next(): IteratorResult<string> {
                while (true) {
                     const res = iterator.next();
                     if (res.done) return { value: undefined, done: true };
                     
                     const key = res.value;
                     const idx = key.indexOf(":");
                     if (idx <= 0) continue; // No prefix or empty prefix?
                     // old code: if (idx===0) continue;
                     
                     const subCacheName = key.substring(0, idx);
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
        return !!this._cache.get(key);
    }

    async key_getCacheMeta(key: string): Promise<CacheMeta | undefined> {
        const entry = this._cache.getWithMeta(key);
        if (!entry) return undefined;
        return (entry.meta as StoredCacheMeta).meta;
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

        const key = subCacheName + ':' + url;
        
        // Allows keeping HTML in cache longer than other types of content.
        //
        let importance = 1;
        if (headers["content-type"]?.startsWith("text/html")) importance = 10;
        
        this._cache.set(key, binary, { importance, meta: storedMeta });
        
        // Return a fresh response from the stored data.
        return this.reconstructResponse(binary, storedMeta);
    }

    key_removeFromCache(key: string): Promise<void> {
        this._cache.delete(key);
        return Promise.resolve();
    }

    key_getFromCache(req: JopiRequest, key: string): Response|undefined {
        const entry = this._cache.getWithMeta<Uint8Array>(key);
        if (!entry) return undefined;
        
        const storedMeta = entry.meta as StoredCacheMeta;
        
        // Validate headers (304 Not Modified etc)
        let cacheRes = req.file_validateCacheHeadersWith(storedMeta.headers || {});
        if (cacheRes) return cacheRes;

        return this.reconstructResponse(entry.value, storedMeta);
    }

    key_getFromCacheWithMeta(req: JopiRequest, key: string): CacheEntry | undefined {
        const entry = this._cache.getWithMeta<Uint8Array>(key);
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
        this.prefix = name + " : ";
    }

    async addToCache(_req: JopiRequest, url: URL, response: Response, meta?: CacheMeta): Promise<Response> {
        return this.parent.key_addToCache(this.prefix, url.href, response, meta);
    }

    async hasInCache(url: URL): Promise<boolean> {
        return this.parent.key_hasInCache(this.prefix + ':' + url.href);
    }

    async getCacheMeta(url: URL): Promise<CacheMeta | undefined> {
        return this.parent.key_getCacheMeta(this.prefix + ':' + url.href);
    }

    removeFromCache(url: URL): Promise<void> {
        return this.parent.key_removeFromCache(this.prefix + ':' + url.href);
    }

    async getFromCache(req: JopiRequest, url: URL): Promise<Response|undefined> {
        return this.parent.key_getFromCache(req, this.prefix + ':' + url.href);
    }

    async getFromCacheWithMeta(req: JopiRequest, url: URL): Promise<CacheEntry | undefined> {
        return this.parent.key_getFromCacheWithMeta(req, this.prefix + ':' + url.href);
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

    if (options.clearOnHotReload) {
        clearHotReloadKey(HOT_RELOAD_KEY);
    }

    gInstance = new InMemoryCache(options);
}

export function getInMemoryCache(): PageCache {
    if (!gInstance) initMemoryCache({});
    return gInstance;
}

let gInstance: InMemoryCache;