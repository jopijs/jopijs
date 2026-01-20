export interface ObjectProvider {
    getValue(id?: string | number, subCacheName?: string): Promise<ObjectProviderValue>;
    refreshValue?(id?: string | number, subCacheName?: string): Promise<any>;
    deleteValue?(id?: string | number, subCacheName?: string): Promise<void>;

    getFromCache?(id?: string | number, subCacheName?: string): Promise<any>;
    addToCache?(id: string | number | undefined, subCacheName: string | undefined, res: ObjectProviderValue): Promise<void>;
    removeFromCache?(id?: string | number, subCacheName?: string): Promise<void>;
}

export interface ObjectProviderValue {
    value?: any;
}