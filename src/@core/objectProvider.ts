export interface ObjectProvider {
    getValue(id?: any, subCacheName?: string): Promise<ObjectProviderValue>;
    
    getFromCache?(id?: any, subCacheName?: string): Promise<any>;
    addToCache?(id: any, subCacheName: string | undefined, res: ObjectProviderValue): Promise<void>;
    deleteFromCache?(id?: any, subCacheName?: string): Promise<void>;
    refreshValue?(id?: any, subCacheName?: string): Promise<any>;
}

export interface ObjectProviderValue {
    value?: any;
}