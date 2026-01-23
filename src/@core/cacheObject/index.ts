export * from "./interfaces.ts";
export * from "./MemoryStore.ts";
export * from "./FileStore.ts";

import type { ObjectCache } from "./interfaces.ts";
import { getInMemoryObjectCache } from "./MemoryStore.ts";

let gObjectCache: ObjectCache | undefined;

/** Returns the current object cache engine instance. */
export function getObjectCache(): ObjectCache {
    if (!gObjectCache) {
        gObjectCache = getInMemoryObjectCache();
    }
    return gObjectCache;
}

/**
 * Sets a custom object cache engine.
 * @param objectCache The cache implementation to use.
 */
export function setObjectCache(objectCache: ObjectCache) {
    gObjectCache = objectCache;
}