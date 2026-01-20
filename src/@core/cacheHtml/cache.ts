import {makeIterable} from "../internalTools.js";
import type {JopiRequest} from "../jopiRequest.ts";

export interface CacheRole {
    isUserCache?: boolean;
    isMobileCache?: boolean;
}

export interface PageCache {
    cacheRole?: CacheRole;

    getFromCache(req: JopiRequest, url: URL): Promise<Response | undefined>;

    getFromCacheWithMeta(req: JopiRequest, url: URL): Promise<CacheEntry | undefined>;
    
    getCacheMeta(url: URL): Promise<CacheMeta | undefined>;

    addToCache(req: JopiRequest, url: URL, response: Response, meta?: CacheMeta): Promise<Response>;

    hasInCache(url: URL): Promise<boolean>;

    removeFromCache(url: URL): Promise<void>;

    createSubCache(name: string): PageCache;

    getSubCacheIterator(): Iterable<string>;

    getCacheEntryIterator(subCacheName?: string): Iterable<CacheEntry>;
}

export class VoidPageCache implements PageCache {
    getFromCache(): Promise<Response | undefined> {
        return Promise.resolve(undefined);
    }

    getFromCacheWithMeta(): Promise<CacheEntry | undefined> {
        return Promise.resolve(undefined);
    }

    getCacheMeta(_url: URL): Promise<CacheMeta | undefined> {
        return Promise.resolve(undefined);
    }

    addToCache(_req: JopiRequest, _url: URL, response: Response, _meta: CacheMeta): Promise<Response> {
        return Promise.resolve(response);
    }

    hasInCache(): Promise<boolean> {
        return Promise.resolve(false);
    }

    removeFromCache(_url: URL): Promise<void> {
        return Promise.resolve();
    }

    createSubCache(): PageCache {
        return this;
    }

    getCacheEntryIterator() {
        return makeIterable({
            next(): IteratorResult<CacheEntry> {
                return { value: undefined, done: true };
            }
        });
    }

    getSubCacheIterator() {
        return makeIterable({
            next(): IteratorResult<string> {
                return { value: undefined, done: true };
            }
        });
    }
}

export type CacheMeta = Record<string, any>;

/**
 * An item stored into the cache.
 */
export interface CacheEntry {
    url: string;
    meta?: CacheMeta;
    response: Response;
}

export interface CacheItemProps {
    url: string;
    binary?: Uint8Array<ArrayBuffer>;
    binarySize?: number;
    isGzipped?: boolean;

    headers?: {[key:string]: string};
    status?: number;
    
    meta: CacheMeta;
}