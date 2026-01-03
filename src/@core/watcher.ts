import { watchProject, type WatcherController } from "jopijs/watcher";
import {getWebSiteConfig} from "jopijs/coreconfig";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as inspector from "node:inspector";

/**
 * Detect if Node.js or Bun.js is running with the debugger launcher.
 */
function isDebugMode(): boolean {
    const args = process.execArgv;
    if (args.some((arg) => arg.includes("--inspect") || arg.includes("--debug") || arg.includes("bootloader.js"))) return true;

    // Check environment variables
    if (process.env.VSCODE_INSPECTOR_OPTIONS) return true;
    
    if (process.env.NODE_OPTIONS) {
        const nodeOptions = process.env.NODE_OPTIONS;
        if (nodeOptions.includes("--inspect") || 
            nodeOptions.includes("--debug") || 
            nodeOptions.includes("bootloader.js") || 
            nodeOptions.includes("js-debug")) {
            return true;
        }
    }

    // Check Bun environment variables
    if (process.env.BUN_INSPECT || process.env.BUN_INSPECT_BRK || process.env.BUN_INSPECT_WAIT) return true;


    // Check inspector url. This is the most reliable way to detect if a debugger is attached.
    try {
        if (inspector.url()) return true;
    } catch { /* ignore */ }

    return false;
}

export function initWatcher(): boolean {
    // No watcher in production mode or debug mode.
    if (gWebSiteConfig.isProduction) return false;

    // Flag is required.
    if (!gWebSiteConfig.hasJopiDevFlag && !gWebSiteConfig.hasJopiDevUiFlag) return false;

    // No watcher in debug mode.
    if (isDebugMode()) return false;

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