import { type ObjectCache, type ObjectProvider, type ObjectProviderParams, getObjectCache } from "jopijs";
import { logObjectProvider } from "./_logs.ts";

/**
 * Implementation of the ObjectProvider wrapper.
 * This class handles the logic for caching, request deduplication (anti-collision),
 * and sub-cache management for a specific object provider.
 * It is automatically instantiated by the JopiJS linker.
 */
export class ImplObjectProvider {
    private pendingRequests = new Map<string, Promise<any>>();
    private subCacheName?: string;

    /**
     * Creates a new instance of ImplObjectProvider.
     * @param key - The unique key identifying this provider.
     * @param objectProvider - The underlying provider definition containing the logic.
     */
    constructor(public readonly key: string, private readonly objectProvider: ObjectProvider) {
    }

    /**
     * Returns a clone of this provider configured to use a specific sub-cache.
     * @param cacheName - The name of the sub-cache to use.
     * @returns A new ImplObjectProvider instance linked to the sub-cache.
     */
    useSubCache(cacheName: string): ImplObjectProvider {
        if (this.subCacheName===cacheName) return this;
        let clone = new ImplObjectProvider(this.key, this.objectProvider);
        clone.subCacheName = cacheName;
        return clone;
    }
    
    /**
     * Retrieves a value by its ID.
     * This method first checks the cache and handles simultaneous requests for the same ID
     * by returning the same promise to all callers (request deduplication).
     * @param id - The unique identifier of the object (optional).
     * @returns A promise that resolves to the value.
     */
    async getValue(id?: string | number): Promise<any> {
        const cache = this._resolveCache();
        const params: ObjectProviderParams = { id, subCacheName: this.subCacheName, key: this.key, cache };

        if (this.objectProvider.directGetValue) {
            return await this.objectProvider.directGetValue(params);
        }

        if (this.objectProvider.getFromCache) {
            return await this.objectProvider.getFromCache(params);
        }

        let fullKey = this.key + (id ? ":" + id : "");
        
        let entry = await cache.get(fullKey);
        //
        if (entry) {
            return entry;
        }

        // Anti-collision system (Request Deduplication):
        // If multiple callers ask for the same key simultaneously (e.g., 5 components needing "Product 101"),
        // we return the existing pending promise instead of triggering the valueProvider 5 times.
        //
        if (this.pendingRequests.has(fullKey)) {
            return this.pendingRequests.get(fullKey);
        }
        
        let promise = (async () => {
            try {
                // Note: using res.value allows
                //       adding cache rules & behaviors into the
                //       response for futur versions.
                //
                logObjectProvider.info(w => w("CALC", {subCache: this.subCacheName, key: this.key, id}));
                let res = await this.objectProvider.getValue(params);
                //
                if (res && res.value !== undefined) {
                    if (res.addToCache !== false) {
                        if (this.objectProvider.addToCache) {
                            await this.objectProvider.addToCache({ ...params, res });
                        } else {
                            await cache.set(fullKey, res.value, res.cacheParams);
                        }
                    }

                    return res.value;
                }
                
                return undefined;
            } finally {
                this.pendingRequests.delete(fullKey);
            }
        })();

        this.pendingRequests.set(fullKey, promise);

        return promise;
    }

    /**
     * Removes a specific item from the cache.
     * @param id - The unique identifier of the object to remove.
     */
    async removeFromCache(id?: string | number): Promise<void> {
        const cache = this._resolveCache();
        const params: ObjectProviderParams = { id, subCacheName: this.subCacheName, key: this.key, cache };

        if (this.objectProvider.removeFromCache) {
            await this.objectProvider.removeFromCache(params);
        } else {
            logObjectProvider.spam(w => w("DELETE", { subCache: this.subCacheName, key: this.key, id }));
            
            await cache.delete(this.key + (id ? ":" + id : ""));
        }
    }

    /**
     * Refreshes the value by bypassing/updating the cache.
     * @param id - The unique identifier of the object to refresh.
     * @returns A promise that resolves to the fresh value.
     */
    async refreshValue(id?: string | number): Promise<any> {
        const cache = this._resolveCache();
        const params: ObjectProviderParams = { id, subCacheName: this.subCacheName, key: this.key, cache };

        if (this.objectProvider.refreshValue) {
            return this.objectProvider.refreshValue(params);
        }

        await this.removeFromCache(id);
        return await this.getValue(id);
    }

    /**
     * Deletes the item from cache and from the underlying storage.
     * @param id - The unique identifier of the object to delete.
     */
    async deleteValue(id?: string | number): Promise<void> {
        await this.removeFromCache(id);
        
        if (this.objectProvider.deleteValue) {
            const cache = this._resolveCache();
            const params: ObjectProviderParams = { id, subCacheName: this.subCacheName, key: this.key, cache };
            await this.objectProvider.deleteValue(params);
        }
    }
    /**
     * Helper to resolve the correct cache instance, initializing subCacheName if needed.
     */
    private _resolveCache(): ObjectCache {
        let cache = getObjectCache();
        
        if (this.subCacheName) {
            return cache.createSubCache(this.subCacheName);
        }
        
        if (this.objectProvider.getDefaultSubCache) {
            this.subCacheName = this.objectProvider.getDefaultSubCache();
            return cache.createSubCache(this.subCacheName);
        }
        
        return cache;
    }
}