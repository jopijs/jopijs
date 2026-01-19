import { getCoreWebSite, type ObjectCache } from "jopijs";

function getObjectCache(): ObjectCache {
    if (!gObjectCache) {
        gObjectCache = getCoreWebSite().getObjectCache();
    }

    return gObjectCache;
}
//
let gObjectCache: ObjectCache | undefined;

interface DataProviderValue {
    value: any;
}

type ValueProviderFunction = (id?: any, subCacheName?: string) => Promise<DataProviderValue|undefined>;

export class DataProvider {
    private pendingRequests = new Map<string, Promise<any>>();
    private subCacheName?: string;

    constructor(public readonly key: string, private readonly valueProvider: ValueProviderFunction) {
    }

    useSubCache(cacheName: string): DataProvider {
        if (this.subCacheName===cacheName) return this;
        let clone = new DataProvider(this.key, this.valueProvider);
        clone.subCacheName = cacheName;
        return clone;
    }
    
    async getValue(id?: any): Promise<any> {
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
                let res = await this.valueProvider(id, this.subCacheName);
                //
                if (res && res.value !== undefined) {
                    await cache.set(fullKey, res.value);
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

    async delete(id?: any): Promise<void> {
        let cache = getObjectCache();
        if (this.subCacheName) cache = cache.createSubCache(this.subCacheName);
        
        return await cache.delete(this.key + (id ? ":" + id : ""));
    }

    async refresh(id?: any): Promise<any> {
        await this.delete(id);
        return await this.getValue(id);
    }
}