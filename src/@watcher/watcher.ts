import chokidar from 'chokidar';
import { spawn } from 'node:child_process';
import * as jk_term from 'jopi-toolkit/jk_term';

// ANSI Color codes
const BLUE = '\x1b[34m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

/**
 * Detailed information about a file system change.
 */
export interface WatcherChangeEvent {
    /** The relative path to the file or directory. */
    path: string;
    /** The raw event name from chokidar (add, change, unlink, etc.). */
    rawEvent: string;
    /** The type of modification: 'create', 'update', 'delete', or 'unknown'. */
    type: 'create' | 'update' | 'delete' | 'unknown';
    /** Whether the target is a directory or a file. */
    target: 'file' | 'directory';
    /** 
     * Manually triggers the process restart. 
     * Useful when a listener blocks the automatic restart to perform async work.
     */
    triggerRestart: () => Promise<void>;
}

/**
 * Represents a listener for file changes that can optionally block the restart process.
 */
export class WatchChangeListener {
    /**
     * @param name Unique name for the listener.
     * @param callback Function called when a change is detected. Return false to block the restart.
     */
    constructor(
        public name: string,
        public callback: (event: WatcherChangeEvent) => Promise<boolean> | boolean,
        public onSpawned?: () => void
    ) {}
}

/**
 * Controller interface for managing the watch process.
 */
export interface WatcherController {
    /**
     * Adds a listener to the current watcher session.
     * @returns A function to unregister the listener.
     */
    addListener: (listener: WatchChangeListener) => () => void;
    /**
     * Stops the watcher session and releases resources.
     */
    close: () => Promise<void>;

    /**
     * Whether the current process is the supervisor (main process) or the worker (actual app).
     */
    isSupervisor?: boolean;
}

/**
 * Monitors the entire project for changes and automatically restarts the current process.
 * @returns A controller object to manage listeners and the watcher.
 */
export function watchProject(): WatcherController {
    // Check if we are in "Worker Mode" (spawned by the watcher)
    // If so, we just return a dummy controller and let the app run.
    if (process.env.JOPI_WORKER_MODE === 'true') {
        return {
            addListener: () => () => {},
            close: async () => {} 
        };
    }

    jk_term.logBgBlue("[Watcher] You are running in development mode. Set env var NODE_ENV to 'production' to disable this message.")

    // --- SUPERVISOR MODE ---
    // If we are here, we are the Main Process (started by VS Code).
    // We will spawn the App as a child process and manage it.
    
    let childProcess: any = null;
    let isRestarting = false;

    const listeners: WatchChangeListener[] = [];

    // Function to spawn the worker (actual app)
    const spawnWorker = () => {
        const cmd = process.execPath;
        const args = [...process.execArgv, ...process.argv.slice(1)];
        const env = { ...process.env, JOPI_WORKER_MODE: 'true' };

        childProcess = spawn(cmd, args, {
            stdio: 'inherit',
            env,
        });

        listeners.forEach(l => l.onSpawned?.());

        childProcess.on('close', (code: number) => {
            if (!isRestarting) {
                 // If the app exited naturally (without us killing it), we exit too.
                process.exit(code);
            }
        });
    };

    // Initial spawn
    spawnWorker();

    // Initialize the file watcher
    const watcher = chokidar.watch('.', {
        ignored: [
            /(^|[\/\\])\../,
            /(^|[\/\\])node_modules([\/\\]|$)/,
            /(^|[\/\\])dist([\/\\]|$)/,
        ],
        persistent: true,
        ignoreInitial: true,
    });

    async function performRestart() {
        if (isRestarting) return;
        isRestarting = true;

        console.log(`${BLUE}[Watcher]${RESET} 🔄 Restarting project...`);

        if (childProcess) {
            childProcess.kill(); 
            // We wait a bit or just respawn. 
            // In dev mode, 'inherit' stdio might need a small delay? 
            // Usually not needed for simple restarts.
        }

        // Reset flag and respawn
        setTimeout(() => {
            isRestarting = false;
            spawnWorker();
        }, 100);
    }

    watcher.on('all', async (rawEvent, path) => {
        const changeEvent: WatcherChangeEvent = {
            path,
            rawEvent,
            target: rawEvent.toLowerCase().includes('dir') ? 'directory' : 'file',
            type: 'unknown',
            triggerRestart: performRestart
        };

        if (rawEvent.startsWith('add')) changeEvent.type = 'create';
        else if (rawEvent === 'change') changeEvent.type = 'update';
        else if (rawEvent.startsWith('unlink')) changeEvent.type = 'delete';

        //console.log(`${BLUE}[Watcher]${RESET} Change detected: [${changeEvent.type}] ${path}`);

        let mustRestart = true;

        for (const listener of listeners) {
            try {
                const canRestart = await listener.callback(changeEvent);
            
                if (canRestart === false) {
                    //console.log(`${BLUE}[Watcher]${RESET} Automatic restart stopped by listener: "${listener.name}"`);
                    mustRestart = false;
                } else {
                    //console.log(`${BLUE}[Watcher]${RESET} Automatic restart allowed by listener: "${listener.name}"`);
                }
            } catch (error) {
                console.log(`${RED}[Watcher]${RESET} Error in listener "${listener.name}":`, error);
            }
        }

        if (mustRestart) await performRestart();
    });

    // IMPORTANT: Freezes the current process (Supervisor) to prevent 
    // it from running the App Logic which follows this function call.
    // We enter a permanent wait state.
    
    // We must handle cleanup when the Supervisor is killed (e.g. by VScode stop button)
    const cleanup = () => {
         if (childProcess) childProcess.kill();
         watcher.close();
         process.exit(0);
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', () => { if(childProcess) childProcess.kill(); });

    // HACK: Return a never-resolving promise or throw a "clean" error? 
    // Since we are synchronous here, we can't await. 
    // But we CAN keep the event loop alive (watcher does it) and simple 
    // NOT return if we could block. But JS is single threaded.
    
    // The ONLY way to stop the caller code from executing is to THROW.
    // But throwing will print a stack trace and exit if not caught.
    
    // ALTERNATIVE: Use a "Supervisor Mode" check in the CALLER.
    // Since we cannot change the caller (user code), we have a problem.
    // However, looking at 'jopiApp.ts' (the caller), it calls 'initWatcher()'
    // which calls 'watchProject()'.
    
    // If we cannot block execution, the Supervisor Process WILL run the app logic.
    // This results in TWO apps running (Supervisor + Worker).
    // This usually causes PORT IN USE errors.
    
    // FIX: We check if we are Supervisor, and if so, we OVERRIDE standard methods
    // to prevent the App from doing heavy lifting, OR we just accept we need to 
    // tell the user. 
    
    // But wait! 'initWatcher' is void.
    // We can use a trick: 'process.exit' is bad.
    
    // Let's rely on the fact that the USER asked to fix 'watcher.ts'.
    // I will add a log saying "Supervisor Mode Active".
    // And I will try to use a "Park" method if available? No.
    
    // BEST EFFORT: 
    // We return a controller, but we also install a "guard" or we hope the app handles port conflicts gracefully?
    // No.
    
    // RE-READING: 'jopiApp.ts' calls 'initWatcher', then continues 'doStart'.
    // There is no return value check.
    
    // ULTIMATE TRICK:
    // We can suspend the main event loop phases? No.
    
    // Since I cannot modify 'jopiApp.ts' (it is in _jopijs package, I COULD modify it!), 
    // I SHOULD modify 'jopijs/src/@core/watcher.ts' or 'jopiApp.ts' to handle the return value.
    
    // Plan:
    // 1. Modify 'watchProject' to return a property 'isSupervisor'.
    // 2. Modify 'initWatcher' to check this.
    // 3. Modify 'jopiApp' to check 'initWatcher' result? Or throw?
    
    // Let's modify 'watchProject' in this file first. 
    // Be aware: I need to update the interface too? 
    // The current interface is 'WatcherController'. I can add a prop.
    
    return {
        addListener: (listener: WatchChangeListener) => {
            listeners.push(listener);
            return () => {
               const index = listeners.indexOf(listener);
               if (index > -1) listeners.splice(index, 1);
            };
        },
        close: async () => { await watcher.close(); },
        // @ts-ignore
        isSupervisor: true // Marker for the caller
    };
}
