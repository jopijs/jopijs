import { watchProject } from "jopijs/watcher";

/**
 * Initializes the file watcher in development mode to enable automatic process restart on changes.
 */
export function initWatcher() {
    if (process.env.JOPI_DEV === "1" || process.env.JOPI_DEV_UI === "1") {
        watchProject();
    }
}