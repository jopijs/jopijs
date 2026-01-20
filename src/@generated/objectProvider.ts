import { getCoreWebSite, type ObjectCache, type ObjectProvider } from "jopijs";

function getObjectCache(): ObjectCache {
    if (!gObjectCache) {
        gObjectCache = getCoreWebSite().getObjectCache();
    }

    return gObjectCache;
}
//
let gObjectCache: ObjectCache | undefined;

export class ImplObjectProvider {
    private pendingRequests = new Map<string, Promise<any>>();
    private subCacheName?: string;

    constructor(public readonly key: string, private readonly objectProvider: ObjectProvider) {
    }

    useSubCache(cacheName: string): ImplObjectProvider {
        if (this.subCacheName===cacheName) return this;
        let clone = new ImplObjectProvider(this.key, this.objectProvider);
        clone.subCacheName = cacheName;
        return clone;
    }
    
    async getValue(id?: string | number): Promise<any> {
        if (this.objectProvider.getFromCache) {
            return await this.objectProvider.getFromCache(id, this.subCacheName);
        }

        let cache = getObjectCache();
        if (this.subCacheName) cache = cache.createSubCache(this.subCacheName);

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
                let res = await this.objectProvider.getValue(id, this.subCacheName);
                //
                if (res && res.value !== undefined) {
                    if (this.objectProvider.addToCache) {
                        await this.objectProvider.addToCache(id, this.subCacheName, res);
                    } else {
                        await cache.set(fullKey, res.value);
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

    async removeFromCache(id?: string | number): Promise<void> {
        if (this.objectProvider.removeFromCache) {
            await this.objectProvider.removeFromCache(id, this.subCacheName);
        } else {
            let cache = getObjectCache();
            if (this.subCacheName) cache = cache.createSubCache(this.subCacheName);
            await cache.delete(this.key + (id ? ":" + id : ""));
        }
    }

    async refreshValue(id?: string | number): Promise<any> {
        if (this.objectProvider.refreshValue) {
            return this.objectProvider.refreshValue(id, this.subCacheName);
        }

        await this.removeFromCache(id);
        return await this.getValue(id);
    }

    async deleteValue(id?: string | number): Promise<void> {
        await this.removeFromCache(id);
        
        if (this.objectProvider.deleteValue) {
            await this.objectProvider.deleteValue(id, this.subCacheName);
        }
    }
}