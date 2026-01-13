import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_crypto from "jopi-toolkit/jk_crypto";
import * as jk_compress from "jopi-toolkit/jk_compress";

import type {CacheEntry, PageCache} from "./cache.ts";
import {octetToMo, ONE_KILO_OCTET, ONE_MEGA_OCTET} from "../publicTools.ts";
import {
    cacheAddBrowserCacheValues,
    cacheEntryToResponse,
    makeIterable,
    readContentLength,
    responseToCacheEntry
} from "../internalTools.ts";
import type {JopiRequest} from "../jopiRequest.tsx";

const clearHotReloadKey = jk_app.clearHotReloadKey;
const keepOnHotReload = jk_app.keepOnHotReload;
const HOT_RELOAD_KEY = "jopi.rewrite.inMemoryCache.hotReloadKey";

export interface InMemoryCacheOptions {
    /**
     * The memory cache survives hot-reload.
     * If a hot-reload occurs, the cache contact is kept as-is.
     * This option allows changing this behavior and automatically clearing
     * the memory cache if a hot-reload is detected.
     */
    clearOnHotReload?: boolean;

    /**
     * If an item is larger than this value, then he will not be added to the cache.
     * Default value is 600 ko.
     */
    maxContentLength?: number;

    /**
     * The max number of items in the cache.
     * Default is 5000.
     */
    maxItemCount?: number;

    /**
     * A delta which allows not triggering garbage collector too soon.
     */
    maxItemCountDelta?: number;

    /**
     * The max memory usage (mesure is Mo).
     * Default is 500Mo
     */
    maxMemoryUsage_mo?: number;

    /**
     * A delta which allows not triggering garbage collector too soon.
     */
    maxMemoryUsageDela_mo?: number;
}

interface MyCacheEntry extends CacheEntry {
    ucpBinary?: Uint8Array<ArrayBuffer>;
    ucpBinarySize?: number;

    gzipBinary?: Uint8Array<ArrayBuffer>;
    gzipBinarySize?: number;
}

class InMemoryCache implements PageCache {
    private readonly subCaches: Record<string, InMemorySubCache> = {};

    createSubCache(name: string): PageCache {
        let cache = this.subCaches[name];
        
        if (!cache) {
            cache = new InMemorySubCache(this, name);
            this.subCaches[name] = cache;
        }

        return cache;
    }

    private readonly cache = keepOnHotReload(HOT_RELOAD_KEY, () => new Map<string, MyCacheEntry>());

    private readonly maxContentLength: number;

    private statItemCount = 0;
    private readonly maxItemCount: number;
    private readonly maxItemCountDelta: number;

    private statMemoryUsage = 0;
    private readonly maxMemoryUsage: number;
    private readonly maxMemoryUsageDelta: number;

    constructor(options?: InMemoryCacheOptions) {
        options = options || {};

        if (!options.maxContentLength) options.maxContentLength = ONE_KILO_OCTET * 600;

        if (!options.maxItemCount) options.maxItemCount = 5000;
        if (!options.maxItemCountDelta) options.maxItemCountDelta = Math.trunc(options.maxItemCount * 0.1);

        if (!options.maxMemoryUsage_mo) options.maxMemoryUsage_mo = 500;
        if (!options.maxMemoryUsageDela_mo) options.maxMemoryUsageDela_mo = Math.trunc(options.maxMemoryUsageDela_mo! * 0.1);

        this.maxContentLength = options.maxContentLength!;

        this.maxItemCount = options.maxItemCount!;
        this.maxItemCountDelta = options.maxItemCountDelta!;

        this.maxMemoryUsage = Math.trunc(options.maxMemoryUsage_mo * ONE_MEGA_OCTET);
        this.maxMemoryUsageDelta = Math.trunc(options.maxMemoryUsageDela_mo * ONE_MEGA_OCTET);
    }

    async addToCache(_req: JopiRequest, url: URL, response: Response, headersToInclude: string[]|undefined): Promise<Response> {
        return this.key_addToCache("", url.toString(), response, headersToInclude);
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

    async hasInCache(url: URL): Promise<boolean> {
        return this.key_hasInCache(':' + url.href);
    }

    private gzipMaxSize = 20 * ONE_MEGA_OCTET;

    /**
     * Set the binary value inside the cache entry.
     * This by compressing the binary if needed.
     */
    private async storeBinary(cacheEntry: MyCacheEntry, response: Response): Promise<boolean> {
        const asBinary = new Uint8Array(await response.arrayBuffer());
        const byteLength = asBinary.byteLength;
        const canCompress = byteLength < this.gzipMaxSize;

        if (!canCompress) {
            cacheEntry.ucpBinary = new Uint8Array(await response.arrayBuffer());
            cacheEntry.ucpBinarySize = cacheEntry.ucpBinary.byteLength;
            return false;
        }

        const bufferGzip = jk_compress.gzipSync(asBinary);
        cacheEntry.gzipBinary = new Uint8Array(bufferGzip.buffer as ArrayBuffer);
        cacheEntry.gzipBinarySize = cacheEntry.gzipBinary.byteLength;
        cacheEntry.isGzipped = true;

        return true;
    }

    getCacheEntryIterator(subCacheName?: string): Iterable<CacheEntry> {
        const iterator = this.cache.entries();
        if (!subCacheName) subCacheName = "";

        return makeIterable({
            next(): IteratorResult<CacheEntry> {
                let result = iterator.next();

                while (!result.done) {
                    let v = result.value[0];
                    let idx = v.indexOf(":");

                    if (subCacheName===v.substring(0, idx)) {
                        const entry = {...result.value[1], url: v.substring(idx+1)};
                        return {value: entry, done: false};
                    }

                    result = iterator.next();
                }

                return { value: undefined, done: true };
            }
        });
    }

    getSubCacheIterator(): Iterable<string> {
        const alreadyReturned: string[] = [];
        const iterator = this.cache.entries();

        return makeIterable({
            next(): IteratorResult<string> {
                while (true) {
                    let result = iterator.next();
                    if (result.done) return { value: undefined, done: true };

                    let key = result.value[0];
                    let idx = key.indexOf(":");

                    if (idx===0) continue;

                    let subCacheName = key.substring(0, idx);

                    if (!alreadyReturned.includes(subCacheName)) {
                        alreadyReturned.push(subCacheName);
                        return { value: subCacheName, done: false };
                    }
                }
            }
        });
    }

    //region With a key

    async key_hasInCache(key: string): Promise<boolean> {
        const cacheEntry = this.cache.get(key);
        return !!cacheEntry;
    }

    async key_addToCache(subCacheName: string, url: string, response: Response, headersToInclude: string[]|undefined) {
        if ((response.status!==200) || (!response.body)) {
            return response;
        }

        const cacheEntry = responseToCacheEntry("", response, headersToInclude) as MyCacheEntry;
        const key = subCacheName + ':' + url;

        const contentLength = readContentLength(response.headers);
        if (contentLength>this.maxContentLength) return response;

        let isGzipped = await this.storeBinary(cacheEntry, response);

        if (cacheEntry.ucpBinary) this.statMemoryUsage += cacheEntry.ucpBinarySize!;
        if (cacheEntry.gzipBinary) this.statMemoryUsage += cacheEntry.gzipBinarySize!;

        if (isGzipped) {
            cacheEntry.binary = cacheEntry.gzipBinary;
            cacheEntry.binarySize = cacheEntry.gzipBinarySize;
        }
        else {
            cacheEntry.binary = cacheEntry.ucpBinary;
            cacheEntry.binarySize = cacheEntry.ucpBinarySize;
        }

        // Add special headers for browser cache control.
        const etag = jk_crypto.fastHash(cacheEntry.binary!);
        cacheAddBrowserCacheValues(cacheEntry, etag);

        response = cacheEntryToResponse(cacheEntry);

        this.cache.set(key, cacheEntry);

        this.statItemCount++;
        cacheEntry._refCount = 1;
        cacheEntry._refCountSinceGC = 1;

        if (this.needToGC()) {
            this.garbageCollector();
        }

        return response;
    }

    key_removeFromCache(key: string): Promise<void> {
        const cacheEntry = this.cache.get(key);

        if (cacheEntry) {
            this.statItemCount--;

            let size = 0;
            if (cacheEntry.ucpBinarySize) size += cacheEntry.ucpBinarySize;
            if (cacheEntry.gzipBinarySize) size += cacheEntry.gzipBinarySize;
            if (size) this.statMemoryUsage -= size;
        }

        return Promise.resolve();
    }

    key_getFromCache(req: JopiRequest, key: string): Response|undefined {
        const res = this.key_getValueFromCache(key);

        if (res) {
            let cacheRes = req.file_validateCacheHeadersWith(res.headers)
            if (cacheRes) return cacheRes;

            return cacheEntryToResponse(res);
        }

        return undefined;
    }

    private key_getValueFromCache(key: string): CacheEntry|undefined {
        const cacheEntry = this.cache.get(key);
        if (!cacheEntry) return undefined;

        cacheEntry._refCount!++;
        cacheEntry._refCountSinceGC!++;

        if (cacheEntry.gzipBinary) {
            cacheEntry.binary = cacheEntry.gzipBinary;
            cacheEntry.binarySize = cacheEntry.gzipBinarySize;
            cacheEntry.isGzipped = true;
            return cacheEntry;
        }

        if (cacheEntry.ucpBinary) {
            cacheEntry.binary = cacheEntry.ucpBinary;
            cacheEntry.binarySize = cacheEntry.ucpBinarySize;
            cacheEntry.isGzipped = false;
            return cacheEntry;
        }

        cacheEntry.binary = undefined;
        return cacheEntry;
    }

    //endregion

    //region Garbage collector

    private needToGC() {
        if (this.statItemCount>this.maxItemCount) return true;
        else if (this.statMemoryUsage>this.maxMemoryUsage) return true;
        return false;
    }

    private garbageCollector() {
        const removeEntry = (key: string, cacheEntry: MyCacheEntry) => {
            keyToRemove.push(key);
            this.statItemCount--;

            let size = 0;
            if (cacheEntry.ucpBinarySize) size += cacheEntry.ucpBinarySize;
            if (cacheEntry.gzipBinarySize) size += cacheEntry.gzipBinarySize;

            if (size) {
                this.statMemoryUsage -= size;

                console.log("|->  ... gc has removed " + key + " / size:", octetToMo(size), "mb");
            } else {
                console.log("|->  ... gc has removed " + key);
            }
        }

        const purge = () => {
            for (const key of keyToRemove) {
                this.cache.delete(key);
            }

            keyToRemove.splice(0);
        }

        function isHtml(cacheEntry: MyCacheEntry) {
            if (!cacheEntry.headers) return false;
            if (!cacheEntry.gzipBinary && !cacheEntry.ucpBinary) return false;

            const contentType = cacheEntry.headers["content-type"];
            return contentType.startsWith("text/html");
        }

        const remove_NotUsedSince = (avoidHtml: boolean) => {
            const limit = this.maxItemCount - this.maxItemCountDelta;
            if (this.statItemCount < limit) return;

            for (const [key, cacheEntry] of this.cache.entries()) {
                if (!cacheEntry._refCountSinceGC) {
                    if (avoidHtml && isHtml(cacheEntry)) {
                        // Avoid removing HTML items since they need calculation.
                        continue;
                    }

                    removeEntry(key, cacheEntry);
                    if (this.statItemCount < limit) return;
                }
            }

            purge();
        }

        const remove_WeighterEntries = (avoidHtml: boolean) => {
            const exec = (): boolean => {
                let maxWeight = 0;
                let maxEntry: CacheEntry | undefined;
                let maxKey = "";

                for (const [key, cacheEntry] of this.cache.entries()) {
                    if (avoidHtml && isHtml(cacheEntry)) {
                        // Avoid removing HTML items since they need calculation.
                        continue;
                    }

                    let size = 0;
                    if (cacheEntry.ucpBinarySize) size += cacheEntry.ucpBinarySize;
                    if (cacheEntry.gzipBinarySize) size += cacheEntry.gzipBinarySize;

                    if (size > maxWeight) {
                        maxWeight = size;
                        maxEntry = cacheEntry;
                        maxKey = key;
                    }

                    cacheEntry._refCountSinceGC = 0;
                }

                if (maxEntry) {
                    removeEntry(maxKey, maxEntry);
                    purge();

                    return true;
                }

                return false;
            }

            const limit = this.maxMemoryUsage - this.maxMemoryUsageDelta;

            while (this.statMemoryUsage > limit) {
                if (!exec()) break;
            }
        }

        const keyToRemove: string[] = [];
        const itemCountBefore = this.statItemCount;
        const memoryUsageBefore = this.statMemoryUsage;

        console.log("====== InMemory cache is executing garbage collector ======");

        remove_WeighterEntries(true);
        remove_WeighterEntries(false);

        remove_NotUsedSince(true);
        remove_NotUsedSince(false);

        for (const [_, cacheEntry] of this.cache.entries()) {
            cacheEntry._refCountSinceGC = 0;
        }

        console.log("===========================================================");
        console.log("Item count ----> before:", itemCountBefore + ", after:", this.statItemCount, " [limit: " + this.maxItemCount + " items]");
        console.log("Memory usage --> before:", octetToMo(memoryUsageBefore) + "Mb, after:", octetToMo(this.statMemoryUsage), "mb [limit: " + octetToMo(this.maxMemoryUsage) + "mb]");
        console.log("===========================================================");
        console.log();
    }

    //endregion
}

class InMemorySubCache implements PageCache {
    private readonly prefix: string;

    constructor(private readonly parent: InMemoryCache, name: string) {
        this.prefix = name + " : ";
    }

    async addToCache(_req: JopiRequest, url: URL, response: Response, headersToInclude: string[]|undefined): Promise<Response> {
        return this.parent.key_addToCache(this.prefix, url.href, response, headersToInclude);
    }

    async hasInCache(url: URL): Promise<boolean> {
        return this.parent.key_hasInCache(this.prefix + ':' + url.href);
    }

    removeFromCache(url: URL): Promise<void> {
        return this.parent.key_removeFromCache(this.prefix + ':' + url.href);
    }

    async getFromCache(req: JopiRequest, url: URL): Promise<Response|undefined> {
        return this.parent.key_getFromCache(req, this.prefix + ':' + url.href);
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