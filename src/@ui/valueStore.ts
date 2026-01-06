export interface IsValueStore {
    getValue<T>(key: string): T | undefined;
    
    setValue(key: string, instance: any): void;

    /**
     * Add a function returning the default value for the object.
     * Will be called if the value is `undefined`.
     */
    addValueProvider<T>(key: string, builder: () => T): void;

    /**
     * Add a value change listener for the object.
     *
     * @returns
     *      Return a function which unregister this listener.
     */
    onValueChange<T>(key: string, listener: (newValue: T, oldValue: T | undefined) => void): () => void;
}

interface ValueStoreEntry {
    builder?: () => any;
    value?: any;
}

type ValueChangeListener<T = any> = (newValue: T, oldValue: T | undefined) => void;

export class ValueStore implements IsValueStore {
    private readonly r: Record<string, ValueStoreEntry> = {};
    private readonly listeners: Record<string, ValueChangeListener[]> = {};

    getValue<T>(key: string): T | undefined {
        let entry = this.r[key];
        if (!entry) return undefined;

        if (entry.value !== undefined) {
            return entry.value as T;
        }

        if (entry.builder) {
            let v = entry.builder() as T;
            this.setValue(key, v);
            return v;
        }

        return undefined;
    }

    setValue(key: string, newValue: any): void {
        let entry = this.r[key];
        if (!entry) this.r[key] = entry = {};

        const oldValue = entry.value;
        entry.value = newValue;

        if (oldValue !== newValue) {
            const keyListeners = this.listeners[key];
            //
            if (keyListeners) {
                keyListeners.forEach(l => l(newValue, oldValue));
            }
        }
    }

    addValueProvider<T>(key: string, builder: () => T): void {
        let entry = this.r[key];
        if (!entry) this.r[key] = entry = {};
        entry.builder = builder;
    }

    onValueChange<T>(key: string, listener: ValueChangeListener<T>): () => void {
        let listeners = this.listeners[key];
        if (!listeners) this.listeners[key] = listeners = [];
        listeners.push(listener);

        return () => {
            const idx = listeners.indexOf(listener);
            if (idx!==-1) listeners.splice(idx, 1);
        }
    }
}

export function getDefaultValueStore(): IsValueStore {
    if (!gValueStore) {
        return gValueStore = new ValueStore();
    }

    return gValueStore;
}

let gValueStore: ValueStore | undefined;