import type {CoreWebSite} from "jopijs/core";
import * as jk_events from "jopi-toolkit/jk_events";
import {DontCallBeforeElapsed} from "jopi-toolkit/jk_tools";


function sse_onChange() {
    const event = new EventSource('/_jopirw_/bundler');
    let isFirstConnection = true;

    // This allows refreshing the browser when
    // the connection is lost, and the browser connects again.
    //
    event.addEventListener('open', () => {
        if (isFirstConnection) isFirstConnection = false;
        else window.location.reload();
    });

    // This allows refreshing the browser when
    // the server sends a signal to the browser.
    //
    event.addEventListener("change", () => {
        console.log("SSE Event [/_jopirw_/bundler] : Refreshing browser");
        window.location.reload();
    });

    // Avoid bug with Chrome when change page more than 6 times.
    // It blocks because SSE events aren't closed du to Chrome page cache internal.
    //
    window.addEventListener('beforeunload', () => { event.close()  });
    window.addEventListener('pagehide', () => { event.close() });
}
//
let g_sse_onChange: string|undefined;

export function getBrowserRefreshScript() {
    if (!g_sse_onChange) {
        g_sse_onChange = sse_onChange.toString();
    }

    return `(${g_sse_onChange})()`;
}

export function installBrowserRefreshSseEvent(webSite: CoreWebSite) {
    webSite.addSseEVent("/_jopirw_/bundler", {
        getWelcomeMessage() {
            return "Jopi - Browser refresh";
        },

        handler(controller) {
            jk_events.addListener("@jopi.bundler.watch.afterRebuild", () => {
                // Can occur multi times with single-page mode.
                if (!gLimitBrowserRefresh.check()) return;

                console.log(`\x1b[34m[Watcher]\x1b[0m 🔄🔥 UI change detected: refreshing browser`);
                controller.send("change", "updated");
            });
        }
    });
}

const gLimitBrowserRefresh = new DontCallBeforeElapsed(2000);
