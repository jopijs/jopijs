
export interface GCEntry {
    _refCountSinceGC: number;
}

export interface GCOptions<T extends GCEntry> {
    cache: Map<string, T>;
    
    // Limits
    maxItemCount: number;
    maxItemCountDelta: number;
    maxMemoryUsage: number;
    maxMemoryUsageDelta: number;
    
    // Current State (Passed for reference/logging, but mainly we use callbacks to update state in caller if needed, 
    // or we just trust the caller to update its state based on onEntryRemoved calls)
    currentItemCount: number;
    currentMemoryUsage: number;
    
    // Logic
    getEntrySize(entry: T): number;
    
    /**
     * If true, the entry will be skipped in the first passes of GC.
     * Use this to protect important items (e.g. HTML pages) unless absolutely necessary to remove them.
     */
    isProtected?(entry: T): boolean;
    
    // Callbacks
    onEntryRemoved(key: string, entry: T): void;
    
    log?(message: string): void;
}

export function runGarbageCollector<T extends GCEntry>(options: GCOptions<T>) {
    let statItemCount = options.currentItemCount;
    let statMemoryUsage = options.currentMemoryUsage;
    
    const keyToRemove: string[] = [];

    const removeEntry = (key: string, cacheEntry: T) => {
        keyToRemove.push(key);
        statItemCount--;
        statMemoryUsage -= options.getEntrySize(cacheEntry);
        
        options.onEntryRemoved(key, cacheEntry);
    };

    const purge = () => {
        for (const key of keyToRemove) {
            options.cache.delete(key);
        }
        keyToRemove.splice(0);
    };

    const remove_NotUsedSince = (avoidProtected: boolean) => {
        const limit = options.maxItemCount - options.maxItemCountDelta;
        if (statItemCount < limit) return;

        for (const [key, cacheEntry] of options.cache.entries()) {
            if (!cacheEntry._refCountSinceGC) {
                if (avoidProtected && options.isProtected && options.isProtected(cacheEntry)) {
                    continue;
                }

                removeEntry(key, cacheEntry);
                if (statItemCount < limit) return;
            }
        }

        purge();
    };

    const remove_WeightedEntries = (avoidProtected: boolean) => {
        const exec = (): boolean => {
            let maxWeight = 0;
            let maxEntry: T | undefined;
            let maxKey = "";

            for (const [key, cacheEntry] of options.cache.entries()) {
                if (avoidProtected && options.isProtected && options.isProtected(cacheEntry)) {
                    continue;
                }

                let size = options.getEntrySize(cacheEntry);

                if (size > maxWeight) {
                    maxWeight = size;
                    maxEntry = cacheEntry;
                    maxKey = key;
                }

                // IMPORTANT: Do NOT reset _refCountSinceGC here.
            }

            if (maxEntry) {
                removeEntry(maxKey, maxEntry);
                purge();
                return true;
            }

            return false;
        };

        const limit = options.maxMemoryUsage - options.maxMemoryUsageDelta;

        while (statMemoryUsage > limit) {
            if (!exec()) break;
        }
    };

    if (options.log) options.log("====== GC Started ======");

    // 1. First pass: Remove largest items, protecting important ones
    remove_WeightedEntries(true);
    
    // 2. Second pass: If still needed, remove largest items including protected ones
    remove_WeightedEntries(false);

    // 3. Third pass: Remove unused items, protecting important ones
    remove_NotUsedSince(true);
    
    // 4. Fourth pass: If still needed, remove unused items including protected ones
    remove_NotUsedSince(false);

    // Reset counters for next run
    for (const [_, cacheEntry] of options.cache.entries()) {
        cacheEntry._refCountSinceGC = 0;
    }

    if (options.log) options.log("====== GC Finished ======");
}
