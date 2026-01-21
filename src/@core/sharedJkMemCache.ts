import * as jk_app from "jopi-toolkit/jk_app";
import { JkMemCache } from "jopi-toolkit/jk_memcache";
import { ONE_MEGA_OCTET } from "./publicTools.ts";

const HOT_RELOAD_KEY = "jopi.core.sharedMemCache";
const keepOnHotReload = jk_app.keepOnHotReload;

let gSharedCache: JkMemCache;

export function getSharedJkMemCache(options?: {
    maxItemCount?: number;
    maxMemoryUsage_mo?: number;
}): JkMemCache {
    if (gSharedCache) return gSharedCache;

    gSharedCache = keepOnHotReload(HOT_RELOAD_KEY, () => {
        const maxCount = options?.maxItemCount || 10000;
        const maxMemoryUsage_mo = options?.maxMemoryUsage_mo || 1000;
        const maxSize = Math.trunc(maxMemoryUsage_mo * ONE_MEGA_OCTET);

        return new JkMemCache({
            name: "JopiSharedCache",
            maxCount,
            maxSize,
            cleanupInterval: 60000
        });
    });

    return gSharedCache;
}
