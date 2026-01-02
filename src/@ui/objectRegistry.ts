export interface IsObjectRegistry {
    getValue<T>(key: string): T | undefined;
    setValue(key: string, instance: any): void;
    addValueProvider<T>(key: string, builder: () => T): void;
    onValueChange<T>(key: string, listener: (newValue: T, oldValue: T | undefined) => void): void;
}

interface ObjectRegistryEntry {
    builder?: () => any;
    value?: any;
}

type ValueChangeListener<T = any> = (newValue: T, oldValue: T | undefined) => void;

export class ObjectRegistry implements IsObjectRegistry {
    private readonly r: Record<string, ObjectRegistryEntry> = {};
    private readonly listeners: Record<string, ValueChangeListener[]> = {};

    getValue<T>(name: string): T | undefined {
        let entry = this.r[name];
        if (!entry) return undefined;

        if (entry.value !== undefined) {
            return entry.value as T;
        }

        if (entry.builder) {
            entry.value = entry.builder();
            return entry.value as T;
        }

        return undefined;
    }

    onValueChange<T>(key: string, listener: ValueChangeListener<T>) {
        if (!this.listeners[key]) this.listeners[key] = [];
        this.listeners[key].push(listener);
    }

    setValue(name: string, instance: any): void {
        let entry = this.r[name];
        if (!entry) this.r[name] = entry = {};

        const oldValue = entry.value;
        entry.value = instance;

        const keyListeners = this.listeners[name];
        //
        if (keyListeners) {
            keyListeners.forEach(l => l(instance, oldValue));
        }
    }

    addValueProvider<T>(name: string, builder: () => T): void {
        let entry = this.r[name];
        if (!entry) this.r[name] = entry = {};
        entry.builder = builder;
    }
}

export function getDefaultObjectRegistry(): IsObjectRegistry {
    if (!gObjectRegistry) {
        return gObjectRegistry = new ObjectRegistry();
    }

    return gObjectRegistry;
}

let gObjectRegistry: ObjectRegistry | undefined;