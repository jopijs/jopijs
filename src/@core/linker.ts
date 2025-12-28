import {type InstallFunction, loadServerInstall, getBrowserInstallFunction, getDefaultLinkerConfig, compile} from "jopijs/linker";
import {UiApplication} from "jopijs/ui";
import * as jk_events from "jopi-toolkit/jk_events";
import {JopiWebSite, type CoreWebSite} from "jopijs";
import {logServer_linker} from "./_logs.ts";
import {DontCallBeforeElapsed} from "jopi-toolkit/jk_tools";

let gBrowserInstallFunction: InstallFunction<UiApplication>;
let gIsInit = false;

export async function initLinker(webSite: JopiWebSite, onWebSiteCreate: (h: (webSite: CoreWebSite) => void|Promise<void>) => void) {
    if (gIsInit) return;
    gIsInit = true;

    const endLog = logServer_linker.beginInfo("Rebuild linker on start");
    await compile(import.meta, getDefaultLinkerConfig());
    endLog();

    gBrowserInstallFunction = await getBrowserInstallFunction();

    await loadServerInstall(webSite, onWebSiteCreate);
}

export function executeBrowserInstall(ctx: UiApplication) {
    if (!gIsInit) return;
    gBrowserInstallFunction(ctx);
}

const gLimitCompileCalls = new DontCallBeforeElapsed(2000);

// Will allows updating shared components and composites.
jk_events.addListener("@jopi.bundler.watch.beforeRebuild", async () => {
    /**
     * This event can occur multiple times with the single-page mode.
     * It's why we limit the number of calls.
     */
    if (!gLimitCompileCalls.check()) return;

    const endLog = logServer_linker.beginInfo("Rebuild linker on change");
    await compile(import.meta, getDefaultLinkerConfig(), true /* is refreshing */);
    endLog();
});