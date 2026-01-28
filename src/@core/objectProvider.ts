import type { ObjectCache, ObjectCacheSetParams } from "./cacheObject";

/**
 * Base parameters passed to ObjectProvider methods.
 */
export interface ObjectProviderParams {
    /**
     * The cache instance associated with this provider/sub-cache.
     */
    cache: ObjectCache;

    /**
     * The name of the provider.
     */
    providerName: string;
}

/**
 * Interface representing a provider for a specific type of object.
 * ObjectProviders are used to centralize data fetching and caching logic.
 * They are typically defined in a module and shared across the application.
 */
export interface ObjectProvider<K=any,V=any> {
    get(keys: K, params: ObjectProviderParams): Promise<V>;
    set?(keys: K, value: V, params: ObjectProviderParams): Promise<void>;
    delete?(keys: K, params: ObjectProviderParams): Promise<void>;
}