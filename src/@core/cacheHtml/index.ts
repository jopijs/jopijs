import type { CacheRules } from "./cache.ts";
import type { PageCache } from "./cache.ts";
import { getInMemoryCache } from "./InMemoryCache.ts";
import { addHeadersToCache } from "../internalTools.ts";

export * from "./cache.ts";

/**
 * Adds a header name to the list of headers that should be cached along with the response.
 * @param header The name of the HTTP header.
 */
export function addHeaderToCache(header: string) {
    addHeadersToCache(header);
}

export function getDefaultHtmlCache(): PageCache {
    if (!gDefaultHtmlCache) gDefaultHtmlCache = getInMemoryCache();
    return gDefaultHtmlCache!;
}

export function setDefaultHtmlCache(htmlCache: PageCache): void {
    gDefaultHtmlCache = htmlCache;
}

export function setHtmlCacheRules(rules: CacheRules[]): void {
    gCacheRules = rules;
}

export function getHtmlCacheRules(): CacheRules[] {
    return gCacheRules;
}

export function getMustUseAutomaticCache(): boolean {
    return gMustUseAutomaticCache;
}

export function setMustUseAutomaticCache(value: boolean): void {
    gMustUseAutomaticCache = value;
}

/** Disables the entire automatic caching system. */
export function disableHtmlCache(): void {
    gMustUseAutomaticCache = false;
}


let gCacheRules: CacheRules[] = [];
let gMustUseAutomaticCache = true;
let gDefaultHtmlCache: PageCache|undefined;