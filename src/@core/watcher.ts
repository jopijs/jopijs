import { watchProject, type WatcherController } from "jopijs/watcher";
import {getWebSiteConfig} from "jopijs/coreconfig";
import * as jk_fs from "jopi-toolkit/jk_fs";
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
    let involvedFiles: Set<string> | null = null;
    const genFile = jk_fs.join(gWebSiteConfig.bundlerOutputDir, "esbuildInvolvedFiles.json");

    watcher.addListener({
        name: "exclude-core-files",
        onSpawned: () => {
            involvedFiles = null;
        },
        callback: async (event) => {
            if (event.path === "global.compiled.css") return false;
            return true;
        }
    });

    watcher.addListener({
        name: "exclude-ui-files",
        onSpawned: () => {
            involvedFiles = null;
        },
        callback: async (event) => {
            if (involvedFiles === null) {
                try {
                    if (await jk_fs.isFile(genFile)) {
                        involvedFiles = new Set(await jk_fs.readJsonFromFile(genFile));
                    } else {
                        involvedFiles = new Set();
                    }
                } catch (e) {
                    console.error("Failed to read esbuildInvolvedFiles.json", e);
                    involvedFiles = new Set();
                }
            }

            if (involvedFiles.has(event.path)) return false;
            
            return true;
        }
    });
}



const gWebSiteConfig = getWebSiteConfig();