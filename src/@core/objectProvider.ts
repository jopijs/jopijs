import type { ObjectCacheSetParams } from "./cacheObject/def.ts";

/**
 * Interface representing a provider for a specific type of object.
 * ObjectProviders are used to centralize data fetching and caching logic.
 * They are typically defined in a module and shared across the application.
 */
export interface ObjectProvider {
    /**
     * Retrieves a value directly without using the cache mechanism or deduplication.
     * When this method is present, it takes precedence over all other retrieval methods.
     * @param id - The unique identifier of the object.
     * @param subCacheName - The name of the sub-cache currently in use.
     * @param key - The key mapped to the object provider.
     * @returns The value retrieved directly.
     */
    directGetValue?(id: string | number | undefined, subCacheName: string | undefined,  key: string): any;

    /**
     * Gets the default sub-cache name used by this provider.
     * This allows grouping related objects in a specific cache partition.
     * @returns The name of the default sub-cache.
     */
    getDefaultSubCache: () => string;

    /**
     * Retrieves a value by its ID from the provider.
     * This method is called by the system when a value is not found in the cache.
     * @param id - The unique identifier of the object.
     * @param subCacheName - The name of the sub-cache currently in use.
     * @returns A promise that resolves to the object provider value.
     */
    getValue(id?: string | number, subCacheName?: string): Promise<ObjectProviderValue>;

    /**
     * Forces a refresh of the value.
     * If not implemented, the system will remove the item from cache and call getValue.
     * @param id - The unique identifier of the object.
     * @param subCacheName - The name of the sub-cache currently in use.
     * @returns A promise that resolves to the refreshed value.
     */
    refreshValue?(id?: string | number, subCacheName?: string): Promise<any>;

    /**
     * Deletes a value from the underlying storage.
     * @param id - The unique identifier of the object.
     * @param subCacheName - The name of the sub-cache currently in use.
     */
    deleteValue?(id?: string | number, subCacheName?: string): Promise<void>;

    /**
     * Custom implementation for retrieving a value from a specific cache.
     * If not provided, the system uses the default ObjectCache.
     * @param id - The unique identifier of the object.
     * @param subCacheName - The name of the sub-cache currently in use.
     * @returns A promise that resolves to the cached value if found.
     */
    getFromCache?(id?: string | number, subCacheName?: string): Promise<any>;

    /**
     * Custom implementation for adding a value to a specific cache.
     * If not provided, the system uses the default ObjectCache.
     * @param id - The unique identifier of the object.
     * @param subCacheName - The name of the sub-cache currently in use.
     * @param res - The value to add to the cache.
     */
    addToCache?(id: string | number | undefined, subCacheName: string | undefined, res: ObjectProviderValue): Promise<void>;

    /**
     * Custom implementation for removing a value from a specific cache.
     * If not provided, the system uses the default ObjectCache.
     * @param id - The unique identifier of the object.
     * @param subCacheName - The name of the sub-cache currently in use.
     */
    removeFromCache?(id?: string | number, subCacheName?: string): Promise<void>;
}

/**
 * Represents the value returned by an ObjectProvider.
 */
export interface ObjectProviderValue {
    /**
     * The actual value of the object.
     */
    value?: any;

    /**
     * If false, don't add entry to the cache.
     */
    addToCache?: boolean;

    /**
     * Optional parameters for the cache storage (TTL, expiration, metadata, importance).
     */
    cacheParams?: ObjectCacheSetParams;
}