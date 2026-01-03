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

    // Some files must be excluded from the watch.
    //
    watcher.addListener({
        name: "exclude-core-files",
        onSpawned: () => {
            involvedFiles = null;
        },
        callback: async (event) => {
            // Generated file.
            if (event.path === "global.compiled.css") return false;

            // Generated file.
            if (event.path.includes(".gen.")) return false;
            return true;
        }
    });

    // If UI mode, then distinguishing between server and UI files.
    // Used by EsBuild? It's an UI file: don't restart the server.
    // Not used by EsBuild? It's a server file: restart the server.
    //
    if (gWebSiteConfig.hasJopiDevUiFlag) {
        console.log("installing exclude-ui-files");
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

                let filePath = jk_fs.resolve(event.path);

                if (involvedFiles.has(filePath)) {
                    console.log("File is used by EsBuild. It's a UI file : don't restart");
                    return false;
                }

                console.log("File is not used by EsBuild. It's a server file : restart");
                return true;
            }
        });
    }
}



const gWebSiteConfig = getWebSiteConfig();