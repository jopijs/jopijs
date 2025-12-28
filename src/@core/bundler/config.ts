import type {Config as TailwindConfig} from 'tailwindcss';
import postcss from 'postcss';
import {CoreWebSite} from "../jopiCoreWebSite.tsx";
import path from "node:path";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_app from "jopi-toolkit/jk_app";

export type PostCssInitializer = (sources: string[], tailwindPlugin:  postcss.AcceptedPlugin|undefined) => postcss.AcceptedPlugin[];

export interface BundlerConfig {
    tailwind: {
        config?: TailwindConfig;

        globalCssContent?: string;
        globalCssFilePath?: string;

        disable?: boolean;
        extraSourceFiles?: string[];
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

let gGlobalCssContent: string | undefined;

export async function getGlobalCssFileContent(config: BundlerConfig): Promise<string> {
    if (gGlobalCssContent) return gGlobalCssContent;

    if (config.tailwind.globalCssContent) {
        return config.tailwind.globalCssContent;
    }

    if (config.tailwind.globalCssFilePath) {
        if (!await jk_fs.isFile(config.tailwind.globalCssFilePath)) {
            throw new Error(`Tailwind - File not found where resolving 'global.css': ${config.tailwind.globalCssFilePath}`);
        }

        return jk_fs.readTextFromFile(config.tailwind.globalCssFilePath);
    }

    let rootDir = jk_fs.dirname(jk_app.findPackageJson());
    let dirItems = await jk_fs.listDir(jk_fs.join(rootDir, "src"));

    let globalCss = `/* Warning: generated file */`;

    let coreGlobalCssPath = jk_fs.join(rootDir, "global.css");

    if (await jk_fs.isFile(coreGlobalCssPath)) {
        let content = await jk_fs.readTextFromFile(coreGlobalCssPath);
        globalCss += "\n\n/* --- Compiled from ./global.css --- */\n\n" + content;
    }

    coreGlobalCssPath = jk_fs.join(rootDir, "src/global.css");

    if (await jk_fs.isFile(coreGlobalCssPath)) {
        let content = await jk_fs.readTextFromFile(coreGlobalCssPath);
        globalCss += "\n\n/* --- Compiled from ./src/global.css --- */\n\n" + content;
    }

    for (let item of dirItems) {
        if (!item.isDirectory) continue;
        if (!item.name.startsWith("mod_")) continue;
        let globalCssPath = jk_fs.join(item.fullPath, "global.css");

        let content = await jk_fs.readTextFromFile(globalCssPath);

        if (content) {
            content = removeImportDoublon(globalCss, content);

            globalCss += `\n\n/* --- Compiled from ./src/${item.name}/global.css --- */`
            globalCss += "\n" + content;
        }
    }

    await jk_fs.writeTextToFile(jk_fs.join(rootDir, "global.compiled.css"), globalCss);

    return gGlobalCssContent = globalCss;
}

/**
 * Remove '@import' already found into globalCss
 */
function removeImportDoublon(globalCss: string, content: string): string {
    let foundImports: Record<string, boolean> = {};

    for (let line of globalCss.split("\n")) {
        let tmp = line.trim();

        if (tmp.startsWith("@import")) {
            foundImports[tmp] = true;
        }
    }

    let lines = [];

    for (let line of content.split("\n")) {
        let tmp = line.trim();

        if (tmp.startsWith("@import")) {
            if (foundImports[tmp]) continue;
            foundImports[tmp] = true;
        }

        lines.push(line);
    }

    return lines.join("\n");
}

// Don't use node_modules because of a bug when using workspaces.
// This bug is doing that WebStorm doesn't resolve the file to his real location
// but to the workspace node_modules (and not the project inside the workspace).
//
let gTempDirPath = path.resolve(jk_app.getTempDir(), ".reactHydrateCache");