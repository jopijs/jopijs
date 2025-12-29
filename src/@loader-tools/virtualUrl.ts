import path from "node:path";
import * as jk_events from "jopi-toolkit/jk_events";
import * as jk_crypto from "jopi-toolkit/jk_crypto";
import {getWebSiteConfig} from "jopijs/coreconfig";

export interface VirtualUrlEntry {
    url: string;
    route: string;
    sourceFile: string;
    bundleFile?: string;
}

const gVirtualUrlMap: VirtualUrlEntry[] = [];

export function getVirtualUrlMap() {
    return gVirtualUrlMap;
}

export function addVirtualUrlEntry(entry: VirtualUrlEntry) {
    gVirtualUrlMap.push(entry);
    jk_events.sendEvent("jopi.virtualUrl.added", entry);
}

export function getVirtualUrlForFile(filePath: string): VirtualUrlEntry|undefined {
    // Avoid creating a second entry if already exist.
    const existing = gVirtualUrlMap.find(e => e.sourceFile === filePath);
    //
    if (existing) {
        return existing;
    }

    const config = getWebSiteConfig();

    let route = path.relative(process.cwd(), filePath);
    route = config.webResourcesRoot_SSR + jk_crypto.md5(route) + path.extname(filePath);

    const entry: VirtualUrlEntry = {
        // Use an url relative to the url base path.
        url: "/" + route,

        route: "/" + route,
        sourceFile: filePath
    };

    addVirtualUrlEntry(entry);
    return entry;
}

// @ts-ignore
global.jopiAddVirtualUrl = (e: VirtualUrlEntry) => {
    addVirtualUrlEntry(e);
}

// @ts-ignore
global.jopiAddVirtualUrlFor = (filePath: string) => {
    getVirtualUrlForFile(filePath);
}