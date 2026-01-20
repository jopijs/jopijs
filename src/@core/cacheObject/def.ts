
export type ObjectCacheMeta = Record<string, string>;

export interface ObjectCacheEntry<T = any> {
    key: string;
    value: T;
    meta: ObjectCacheMeta;
}

export interface ObjectCache {
    get<T = any>(key: string): Promise<T | undefined>;
    
    getWithMeta<T = any>(key: string): Promise<{ value: T; meta: ObjectCacheMeta } | undefined>;
    
    set<T = any>(key: string, value: T, meta?: ObjectCacheMeta): Promise<void>;
    
    delete(key: string): Promise<void>;
    
    has(key: string): Promise<boolean>;
    
    keys(): Iterable<string>;

    getSubCacheIterator(): Iterable<string>;

    /**
     * Create or retrieve a sub-cache with the given name.
     * The implementation must store the created sub-caches and return the existing one if it was already created.
     */
    createSubCache(name: string): ObjectCache; 
}
