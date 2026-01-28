import { type ObjectCache, type ObjectProvider, type ObjectProviderParams, getObjectCache } from "jopijs";

/**
 * Implementation of the ObjectProvider wrapper.
 */
export class ImplObjectProvider<K,V> {
    private params: ObjectProviderParams = {
        providerName: "",
        cache: getObjectCache()
    };

    /**
     * Creates a new instance of ImplObjectProvider.
     * @param providerName - The name of this provider.
     * @param objectProvider - The underlying provider definition containing the logic.
     */
    constructor(providerName: string, private readonly objectProvider: ObjectProvider<K,V>) {
        this.params.providerName = providerName;
    }

    async get(keys: K): Promise<V> {
        return await this.objectProvider.get(keys, this.params);
    }

    async set(keys: K, data: V): Promise<void> {
        if (this.objectProvider.set) {
            return await this.objectProvider.set(keys, data, this.params);
        }
    }

    async delete(keys: K): Promise<void> {
        if (this.objectProvider.delete) {
            return await this.objectProvider.delete(keys, this.params);
        }
    }
}