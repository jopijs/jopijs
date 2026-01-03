import { watchProject, type WatcherController } from "jopijs/watcher";
import {getWebSiteConfig} from "jopijs/coreconfig";
import * as jk_process from "jopi-toolkit/jk_process";

export function initWatcher(): boolean {
    // No watcher in production mode or debug mode.
    if (gWebSiteConfig.isProduction) return false;

    // Flag is required.
    if (!gWebSiteConfig.hasJopiDevFlag && !gWebSiteConfig.hasJopiDevUiFlag) return false;

    // No watcher in debug mode.
    if (jk_process.isLaunchedWithDebugger()) return false;

    const watcher = watchProject();

    if (watcher.isSupervisor) {
        initializeRules(watcher);
        return true;
    }

    return false;
}

function initializeRules(watcher: WatcherController) {

    const isUidDev = gWebSiteConfig.hasJopiDevUiFlag;
    
    // Some files must be excluded from the watch.
    //
    watcher.addListener({
        name: "exclude-core-files",

        callback: async (event) => {
            // Generated file.
            if (event.path === "global.compiled.css") return false;

            // Generated file.
            if (event.path.includes(".gen.")) return false;
            return true;
        }
    });

    if (gWebSiteConfig.hasJopiDevUiFlag) {
        watcher.addListener({
            name: "ui-dev",

            callback: async (event) => {
                // Don't restart the server if the file is only updated.
                if (event.type === "update") return false;
                return true;
            }
        });
    }
}



const gWebSiteConfig = getWebSiteConfig();