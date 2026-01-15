import { spawn } from 'node:child_process';
import { watchProject, type WatcherController } from "jopijs/watcher";
import {getWebSiteConfig} from "jopijs/coreconfig";
import * as jk_process from "jopi-toolkit/jk_process";
import { getSsgEnvValue } from "./jopiApp.ts";

export function isSupervisorProcess() {
    return gIsSupervisor;
}

let gIsSupervisor = false;

export function initProcessSupervisor(isSsgMode: boolean = false): boolean {
    if (process.env.JOPI_WORKER_MODE === "1") {
        return false;
    }

    // No watcher in production mode or debug mode (unless forced).
    if (!isSsgMode) {
        if (gWebSiteConfig.isProduction) return false;
        
        // Flag is required.
        if (!gWebSiteConfig.hasJopiDevServerFlag && !gWebSiteConfig.hasJopiDevUiFlag) return false;

        // No watcher in debug mode.
        if (jk_process.isLaunchedWithDebugger()) return false;
    }

    if (isSsgMode) {
        gIsSupervisor = true;
        spawnChild_noWatch();

        // Avoid the caller to quit.
        return false;
    }

    const watcher = watchProject();

    if (watcher.isSupervisor) {
        gIsSupervisor = true;
        initializeRules(watcher);
        return true;
    }

    return false;
}

function spawnChild_noWatch() {
    const cmd = process.execPath;
    const args = [...process.execArgv, ...process.argv.slice(1)];
    const env = { ...process.env, JOPI_WORKER_MODE: "1" };

    const childProcess = spawn(cmd, args, {
        stdio: 'inherit',
        env,
    });

    childProcess.on('close', (code: number) => {
        process.exit(code);
    });
    
    childProcess.on('error', (err) => {
        console.error(`[Watcher] Child process error:`, err);
    });

    const cleanup = () => {
         if (childProcess) childProcess.kill();
         process.exit(0);
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', () => { if(childProcess) childProcess.kill(); });
}

function initializeRules(watcher: WatcherController) {
    // Some files must be excluded from the watch.
    //
    watcher.addListener({
        name: "exclude-core-files",

        callback: async (event) => {
            // Generated file.
            if (event.path.includes(".gen.")) return false;
            return true;
        }
    });

    // UI dev mode: don't restart on update.
    // But restart on file created/deleted, which is required for new routes.
    //
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

    // Ignore SSG output directory to prevent restart loops.
    //
    const ssgEnv = getSsgEnvValue();
    //
    if (ssgEnv && ssgEnv.length > 1) {
        const ignoredDir = ssgEnv.startsWith("./") ? ssgEnv.substring(2) : ssgEnv;
        
        watcher.addListener({
            name: "ignore-ssg-output",
            callback: async (event) => {
                if (event.path.includes(ignoredDir)) return false;
                return true;
            }
        });
    } else {
        // Not UI dev mode ? Always restart.
    }
}

const gWebSiteConfig = getWebSiteConfig();