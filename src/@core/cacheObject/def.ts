
export interface ObjectCacheMeta {
    addedDate?: number;
    [key: string]: any;
}

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

    createSubCache(name: string): ObjectCache; 
}
