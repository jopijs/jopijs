import {makeIterable} from "../internalTools.js";
import type {JopiRequest} from "../jopiRequest.ts";
import type {RouteSelector} from "../routes.ts";

export interface CacheRules {
    /**
     * Allows selecting routes on which this cache rules will apply.
     */
    routeSelector: RouteSelector;

    /**
     * If true, then disable the cache for the routes.
     */
    disableAutomaticCache?: boolean;

    /**
     * Define a function which is called to read the cache.
     * This allows replacing the default cache reading behavior.
     */
    readCacheEntry?(req: JopiRequest): Promise<Response | undefined>;

    /**
     * Define a function which is called when the response is get from the cache.
     * If a value is returned, then this value is used as the new value,
     * allowing to replace what comes from the cache.
     * @param handler
     */
    afterGetFromCache?: (req: JopiRequest, res: Response) => Promise<Response | undefined | void>;

    /**
     * Defines a function which can alter the response to save into the cache or avoid cache adding.
     * If returns a response: this response will be added into the cache.
     * If returns undefined: will not add the response into the cache.
     */
    beforeAddToCache?: (req: JopiRequest, res: Response) => Promise<Response | undefined | void>;

    /**
     * Define a function which is called before checking the cache.
     * This allows doing some checking, and if needed, it can return
     * a response and bypass the request cycle.
     */
    beforeCheckingCache?: (req: JopiRequest) => Promise<Response | undefined | void>;

    /**
     * Define a function which is called when the response is not in the cache.
     */
    ifNotInCache?(req: JopiRequest, isPage: boolean): void;
}

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

    getCacheEntrySize(url: URL): Promise<number | undefined>;

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

    getCacheEntrySize(_url: URL): Promise<number | undefined> {
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