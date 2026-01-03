import chokidar from 'chokidar';
import { spawn } from 'node:child_process';

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
        public callback: (event: WatcherChangeEvent) => Promise<boolean> | boolean
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
}

/**
 * Monitors the entire project for changes and automatically restarts the current process.
 * @returns A controller object to manage listeners and the watcher.
 */
export function watchProject(): WatcherController {
    const listeners: WatchChangeListener[] = [];

    // Initialize the file watcher on the current directory
    const watcher = chokidar.watch('.', {
        // Ignore noise: hidden files, node_modules, and dist folders
        ignored: [
            /(^|[\/\\])\../,         // Hidden files (.git, .env, etc.)
            '**/node_modules/**',    // Dependencies
            '**/dist/**',            // Build output
        ],
        // Do not prevent the process from exiting naturally
        persistent: false,
        // Do not trigger events for files that already exist at startup
        ignoreInitial: true,
    });

    /**
     * Internal function to perform the actual restart.
     */
    async function performRestart() {
        console.log(`${BLUE}[Watcher]${RESET} 🔄 Restarting project...`);

        // Gracefully close the watcher
        await watcher.close();

        // Spawn a new instance of the current process
        spawn(process.argv[0], process.argv.slice(1), {
            stdio: 'inherit',
            env: process.env,
        });

        // Exit the current process to let the new one take over
        process.exit(0);
    }

    let timeout: any;

    // Listen for any file system event
    watcher.on('all', (rawEvent, path) => {
        // Clear previous timeout to debounce multiple rapid changes
        clearTimeout(timeout);

        // Map chokidar events to simple metadata
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

        // Wait 100ms before restarting to ensure all file writes are finished
        timeout = setTimeout(async () => {
            // Execute all listeners and check if any of them blocks the restart
            for (const listener of listeners) {
                try {
                    const canRestart = await listener.callback(changeEvent);
                    if (canRestart === false) {
                        console.log(`${BLUE}[Watcher]${RESET} Automatic restart stopped by listener: "${listener.name}"`);
                        return; // Stop the automatic restart process
                    }
                } catch (error) {
                    console.log(`${RED}[Watcher]${RESET} Error in listener "${listener.name}":`, error);
                }
            }

            console.log(`${BLUE}[Watcher]${RESET} 🔄 Change detected: [${changeEvent.type}] ${path}`);
            await performRestart();
        }, 100);
    });

    return {
        addListener: (listener: WatchChangeListener) => {
            listeners.push(listener);
            return () => {
                const index = listeners.indexOf(listener);
                if (index > -1) listeners.splice(index, 1);
            };
        },
        close: () => watcher.close()
    };
}
