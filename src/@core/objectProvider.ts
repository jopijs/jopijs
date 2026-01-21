import type { ObjectCache, ObjectCacheSetParams } from "./cacheObject";

/**
 * Base parameters passed to ObjectProvider methods.
 */
export interface ObjectProviderParams {
    /**
     * The unique identifier of the object.
     */
    id?: string | number;

    /**
     * The name of the sub-cache currently in use.
     */
    subCacheName?: string;

    /**
     * The key mapped to the object provider.
     */
    key: string;

    /**
     * The cache instance associated with this provider/sub-cache.
     */
    cache: ObjectCache;
}

export interface ObjectProviderGetValueParams extends ObjectProviderParams {}
export interface ObjectProviderDirectGetValueParams extends ObjectProviderParams {}
export interface ObjectProviderRefreshValueParams extends ObjectProviderParams {}
export interface ObjectProviderDeleteValueParams extends ObjectProviderParams {}
export interface ObjectProviderGetFromCacheParams extends ObjectProviderParams {}
export interface ObjectProviderRemoveFromCacheParams extends ObjectProviderParams {}

/**
 * Parameters for adding a value to the cache.
 */
export interface ObjectProviderAddToCacheParams extends ObjectProviderParams {
    /**
     * The value to add to the cache.
     */
    res: ObjectProviderValue;
}

/**
 * Interface representing a provider for a specific type of object.
 * ObjectProviders are used to centralize data fetching and caching logic.
 * They are typically defined in a module and shared across the application.
 */
export interface ObjectProvider {
    /**
     * Retrieves a value directly without using the cache mechanism or deduplication.
     * When this method is present, it takes precedence over all other retrieval methods.
     * @param params - The parameters including id, subCacheName, and key.
     * @returns The value retrieved directly.
     */
    directGetValue?(params: ObjectProviderDirectGetValueParams): any;

    /**
     * Gets the default sub-cache name used by this provider.
     * This allows grouping related objects in a specific cache partition.
     * @returns The name of the default sub-cache.
     */
    getDefaultSubCache: () => string;

    /**
     * Retrieves a value by its ID from the provider.
     * This method is called by the system when a value is not found in the cache.
     * @param params - The parameters including id, subCacheName, and key.
     * @returns A promise that resolves to the object provider value.
     */
    getValue(params: ObjectProviderGetValueParams): Promise<ObjectProviderValue>;

    /**
     * Forces a refresh of the value.
     * If not implemented, the system will remove the item from cache and call getValue.
     * @param params - The parameters including id, subCacheName, and key.
     * @returns A promise that resolves to the refreshed value.
     */
    refreshValue?(params: ObjectProviderRefreshValueParams): Promise<any>;

    /**
     * Deletes a value from the underlying storage.
     * @param params - The parameters including id, subCacheName, and key.
     */
    deleteValue?(params: ObjectProviderDeleteValueParams): Promise<void>;

    /**
     * Custom implementation for retrieving a value from a specific cache.
     * If not provided, the system uses the default ObjectCache.
     * @param params - The parameters including id, subCacheName, and key.
     * @returns A promise that resolves to the cached value if found.
     */
    getFromCache?(params: ObjectProviderGetFromCacheParams): Promise<any>;

    /**
     * Custom implementation for adding a value to a specific cache.
     * If not provided, the system uses the default ObjectCache.
     * @param params - The parameters including id, subCacheName, key, and res.
     */
    addToCache?(params: ObjectProviderAddToCacheParams): Promise<void>;

    /**
     * Custom implementation for removing a value from a specific cache.
     * If not provided, the system uses the default ObjectCache.
     * @param params - The parameters including id, subCacheName, and key.
     */
    removeFromCache?(params: ObjectProviderRemoveFromCacheParams): Promise<void>;
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