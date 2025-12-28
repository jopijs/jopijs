import postcss from 'postcss';
import {CoreWebSite} from "../jopiCoreWebSite.tsx";
import path from "node:path";
import * as jk_app from "jopi-toolkit/jk_app";

export type PostCssInitializer = (sources: string[], tailwindPlugin:  postcss.AcceptedPlugin|undefined) => postcss.AcceptedPlugin[];

export interface BundlerConfig {
    tailwind: {
        disable?: boolean;
    },

    postCss: {
        initializer?: PostCssInitializer;
    },

    embed: {
        dontEmbedThis?: string[];
    },

    entryPoints: string[];
}

const gBundlerConfig: BundlerConfig = {
    tailwind: {},
    postCss: {},
    embed: {},
    entryPoints: []
}

export function getBundlerConfig(): BundlerConfig {
    return gBundlerConfig;
}

export function getBundleDirPath(webSite: CoreWebSite) {
    // To known: the loader uses jopi.webSiteUrl from "package.json".
    // This can create a situation where we have 2 output directories for
    // the same website.
    //
    let webSiteHost = (webSite as CoreWebSite).host.replaceAll(".", "_").replaceAll(":", "_");
    return path.join(gTempDirPath, webSiteHost);
}

// Don't use node_modules because of a bug when using workspaces.
// This bug is doing that WebStorm doesn't resolve the file to his real location
// but to the workspace node_modules (and not the project inside the workspace).
//
let gTempDirPath = path.resolve(jk_app.getTempDir(), ".reactHydrateCache");