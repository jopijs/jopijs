import fs from "node:fs";
import {type ChildProcess, spawn} from "node:child_process";
import path from "node:path";
import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_os from "jopi-toolkit/jk_os";
import * as jk_term from "jopi-toolkit/jk_term";
import {SourceChangesWatcher} from "./sourceChangesWatcher.ts";

// *************************
const FORCE_LOG = false;
const VERSION = "20251229";
// *************************

let mustLog = false; // Set env var JOPI_LOG to 1 to enable.

interface WatchInfos {
    needHot: boolean;
    needWatch: boolean;
    needUiWatch: boolean;

    hasJopiWatchTask?: boolean;
    hasJopiBuildTask_node?: boolean;
    hasJopiWatchTask_node?: boolean;
    hasJopiWatchTask_bun?: boolean;
    hasJopiBuildTask_bun?: boolean;

    packageJsonFilePath?: string;
}

enum DevModType {
    NONE = "none",
    FULL_RELOAD = "full-reload",
    UI_REBUILD = "ui-rebuild"
}

function getDevModeType(): DevModType {
    let modFullReload = false;
    let modUiRebuild = false;

    //region Test jopi-dev

    let idx = process.argv.indexOf("--jopi-dev");

    if (idx!==-1) {
        process.argv.splice(idx, 1);
        modFullReload = true;
    }

    if (process.env.JOPI_DEV === "1") {
        modFullReload = true;
    }

    //endregion

    //region Test jopi-dev-ui

    idx = process.argv.indexOf("--jopi-dev-ui");

    if (idx!==-1) {
        process.argv.splice(idx, 1);
        modUiRebuild = true;
    }

    if (process.env.JOPI_DEV_UI === "1") {
        modUiRebuild = true;
    }

    //endregion

    if (modUiRebuild) return DevModType.UI_REBUILD;
    if (modFullReload) return DevModType.FULL_RELOAD;
    return DevModType.NONE;
}

const gNeedUseShell = process.platform === 'win32';

export async function jopiLauncherTool(jsEngine: string) {
    function execTask(taskName: string): Promise<void> {
        return new Promise((resolve, reject) => {
            let cwd = path.dirname(config.packageJsonFilePath!);
            let cmd = isNodeJs ? "npm" : "bun";
            const child = spawn(cmd, ["run", taskName], {stdio: "inherit", cwd, env, shell: gNeedUseShell});

            child.on('exit', (code) => {
                if (code === 0) { resolve() }
                else { reject(new Error(`Task ${taskName} exited with code ${code}`)); }
            });

            child.on('error', (err) => {
                console.log(`Error executing npm script ${taskName}, command line: ${[cmd, "run", taskName].join(" ")}`);
                console.log("CWD:", cwd);
                console.log("Error:", err.message);
                reject(err);
            });
        });
    }

    function onSpawned() {
        // Nothing to do. Keep for future usages.
    }

    async function getConfiguration(): Promise<WatchInfos> {
        let res: WatchInfos = {
            needHot: false,
            needUiWatch: gDevModeType === DevModType.UI_REBUILD,
            needWatch: gDevModeType === DevModType.FULL_RELOAD
        };

        let pckJson = jk_app.findPackageJson();

        if (pckJson) {
            if (mustLog) console.log("JopiJS - package.json file found at", pckJson);

            res.packageJsonFilePath = pckJson;

            try {
                let json = JSON.parse(await jk_fs.readTextFromFile(pckJson));
                let jopi: any = json["jopi"];

                if (jopi) {
                    if (jopi.needUiWatch===true) {
                        res.needUiWatch = true;
                    }
                    else if (jopi.watch===true) {
                        res.needWatch = true;
                    }
                }

                if (json.scripts) {
                    let scripts = json.scripts;

                    if (scripts.jopiWatch) res.hasJopiWatchTask = true;
                    if (scripts.jopiWatch_node) res.hasJopiWatchTask_node = true;
                    if (scripts.jopiWatch_bun) res.hasJopiWatchTask_bun = true;

                    if (scripts.jopiBuild_node) res.hasJopiBuildTask_node = true;
                    if (scripts.jopiBuild_bun) res.hasJopiBuildTask_bun = true;
                }
            }
            catch (e) {
                console.error(e);
            }
        } else if (process.env.NODE_ENV !== 'production') {
            console.warn("JopiJS - package.json not found, can't enable file watching");
        }

        let watch = process.env.WATCH;

        if (watch) {
            switch (watch) {
                case "0":
                case "false":
                case "no":
                    break;
                case "1":
                case "true":
                case "yes":
                    res.needWatch = true;
                    break;
            }
        }

        return res;
    }

    const importFlag = jsEngine === "node" ? "--import" : "--preload";
    const isNodeJs = jsEngine == "node";

    mustLog = process.env.JOPI_LOG==="1" || FORCE_LOG;

    if (mustLog) {
        console.log("JopiJS Lib Version:", VERSION, " - engine:", jsEngine);
    }

    // Here first is node.js, second is jopi. (it's du to shebang usage).
    let argv = process.argv.slice(2);

    if (!argv.length) {
        console.log("JopiJS loader v"+ VERSION +" installed at ", import.meta.dirname);
        return;
    }

    // Catch --hot and --watch, and remove them.
    //
    argv = argv.filter(arg => {
        if (arg === "--hot") {
            config.needHot = true;
            config.needWatch = true;
            return false;
        }

        if (arg === "--watch") {
            config.needHot = false;
            config.needWatch = true;
            return false;
        }

        return arg !== "--watch-path";
    });

    const preloadArgs: string[] = [importFlag, "jopijs/loader"];

    if (jsEngine==="node") {
        // Some things don't work with the new loader system.
        // It's why we use a mix old/next system.
        //
        preloadArgs.push("--loader", "jopijs/loader/loader.mjs");

        // Avoid some warning.
        preloadArgs.push("--no-warnings");
    }

    let cmd = jk_os.whichSync(jsEngine, jsEngine)!;
    if (mustLog) console.log("JopiJS - Loader using " + jsEngine + " from:", cmd);
    let args = [...preloadArgs, ...argv];

    let config = await getConfiguration();

    const cwd = process.cwd();
    let env: Record<string, string> = {...process.env} as Record<string, string>;
    let enableFileWatcher = false;

    if (config.needWatch || config.needUiWatch) {
        if (config.needWatch) env["JOPI_DEV"] = "1";
        if (config.needUiWatch) env["JOPI_DEV_UI"] = "1";

        let toPrepend: string[] = [];

        if (config.needWatch) {
            if (config.needHot) {
                toPrepend.push("--hot");
            }
            else {
                enableFileWatcher = true;
                env["JOPI_CUSTOM_WATCHER"] = "1";
                jk_term.logBlue("JopiJS - Source watching enabled.");
            }

            args = [...toPrepend, ...args];
        }
    }

    if (mustLog) {
        console.log("JopiJS - Use current working dir:", cwd);
        console.log("JopiJS - Executing:", cmd, ...args);
    }

    // If dev-mode, then execute the scripts
    // jopiWatch_node/jopiWatch_bun from package.json
    //
    if (gDevModeType === DevModType.FULL_RELOAD) {
        if (config.hasJopiWatchTask) await execTask("jopiWatch");
        if (isNodeJs && config.hasJopiWatchTask_node) await execTask("jopiWatch_node");
        if (!isNodeJs && config.hasJopiWatchTask_bun) await execTask("jopiWatch_bun");
    } else {
        if (isNodeJs && config.hasJopiBuildTask_node) await execTask("jopiBuild_node");
        if (!isNodeJs && config.hasJopiBuildTask_bun) await execTask("jopiBuild_bun");
    }

    if (enableFileWatcher) {
        if (mustLog) console.log("Using SourceChangesWatcher");

        const watcher = new SourceChangesWatcher({
            watchDirs: [path.join(process.cwd(), "src")],
            excludeDir: [path.join(process.cwd(), "src", ".jopi-codegen")],
            isDev: true, env, cmd, args, mustLog: mustLog,
            jsEngine
        });

        await watcher.start();

    } else {
        if (mustLog) console.log("Is not using SourceChangesWatcher");

        spawnChild({
            cmd, env, args, onSpawned, cwd: process.cwd(), killOnExit: false
        });
    }
}

export interface SpawnParams {
    env?: Record<string, string>;
    cmd: string;
    args: string[];
    cwd: string;
    killOnExit: boolean;
    onSpawned?: (child: ChildProcess) => void;
}

function killAll(signalName: NodeJS.Signals) {
    gToKill.forEach(child => {
        if (child.killed) return;

        if (gDevModeType!==DevModType.NONE) {
            // > If dev-mode, directly do a fast hard kill.
            child.kill('SIGKILL');
            process.exit(0);
        } else {
            try {
                child.kill(signalName);
            }
            catch {
            }

            setTimeout(() => {
                if (!child.killed) {
                    child.kill('SIGKILL');
                }
            }, 1000);
        }
    });
}

function spawnChild(params: SpawnParams): void {
    let useShell = params.cmd.endsWith('.cmd') || params.cmd.endsWith('.bat') || params.cmd.endsWith('.sh');

    /*if (mustLog) {
        console.log("spawnChild", {cmd: params.cmd, args: params.args, cwd: process.cwd(), useShell})
    }*/

    const child = spawn(params.cmd, params.args, {
        stdio: "inherit", shell: useShell,
        cwd: process.cwd(),
        env: params.env
    });

    gToKill.push(child);

    if (params.killOnExit) {
        child.on('exit', (code, signal) => {
            // The current instance has stopped?
            if (signal) process.kill(process.pid, signal);
            else process.exit(code ?? 0);
        });

        child.on('error', (err) => {
            // The current instance is in error?
            console.error(err.message || String(err));
            process.exit(1);
        });
    }

    if (params.onSpawned) {
        child.on('spawn', () => {
            params.onSpawned!(child);
        })
    }
}

// Allow a killing child process when this process exits.

process.on('SIGTERM', () => killAll("SIGTERM"));
process.on('SIGINT', () => killAll("SIGINT"));
process.on('SIGHUP', () => killAll("SIGHUP"));
process.on('exit', () => killAll("exit" as NodeJS.Signals));

const gDevModeType = getDevModeType();
const gToKill: ChildProcess[] = [];