import * as jk_app from "jopi-toolkit/jk_app";
import {getModulesList} from "jopijs/modules";

import fs from "node:fs/promises";
import postcss from "postcss";
import * as jk_fs from "jopi-toolkit/jk_fs";
import path from "node:path";
import type {CreateBundleParams} from "jopijs/core";
import {getTailwindPlugin} from "./tailwinPlugin.ts";
import {execConsoleMuted} from "./tools.ts";
import * as jk_term from "jopi-toolkit/jk_term";

/**
 * Use Tailwind to compile the file global.css from the bundler dir
 * and save the result into the out dir.
 */
export async function tailwindTransformGlobalCss(params: CreateBundleParams): Promise<void> {
    function append(text: string) {
        return fs.appendFile(outFilePath, "\n" + text + "\n", "utf-8");
    }

    let genDir = params.genDir;

    // >>> Tailwind transform

    if (params.singlePageMode) {
        genDir = jk_fs.join(genDir, params.pageKey!);
    }

    const outFilePath = path.resolve(genDir, "global.css");
    await jk_fs.unlink(outFilePath);

    // Assure the file exists.
    await jk_fs.writeTextToFile(outFilePath, "");

    if (!params.config.tailwind.disable) {
        const tailwindPlugin = getTailwindPlugin(true);
        let postCss = await tailwindCompile(tailwindPlugin, params.outputDir);
        if (postCss) await append(postCss);
    }
}

/**
 * Merge all global.css files into one file.
 */
export async function getMergedGlobalCssFileContent(): Promise<string> {
    if (gGlobalCssContent) return gGlobalCssContent;

    const rootDir = jk_fs.dirname(jk_app.findRequiredPackageJson());
    let globalCss = `/* Warning: generated file */`;
    let isEmpty = true;

    let coreGlobalCssPath = jk_fs.join(rootDir, "global.css");
    //
    if (await jk_fs.isFile(coreGlobalCssPath)) {
        isEmpty = false;
        let content = await jk_fs.readTextFromFile(coreGlobalCssPath);
        globalCss += "\n\n/* --- Compiled from ./global.css --- */\n\n" + content;
    }

    coreGlobalCssPath = jk_fs.join(rootDir, "src", "global.css");
    //
    if (await jk_fs.isFile(coreGlobalCssPath)) {
        isEmpty = false;
        let content = await jk_fs.readTextFromFile(coreGlobalCssPath);
        globalCss += "\n\n/* --- Compiled from ./src/global.css --- */\n\n" + content;
    }

    let modulesList = await getModulesList();

    for (let mod of Object.values(modulesList)) {
        let globalCssPath = jk_fs.join(mod.fullPath, "global.css");

        let content = await jk_fs.readTextFromFile(globalCssPath);

        if (content) {
            content = removeImportDoublon(globalCss, content);

            globalCss += `\n\n/* --- Compiled from ./src/${mod.modName}/global.css --- */`
            globalCss += "\n" + content;
            isEmpty = false;
        }
    }

    if (isEmpty) {
        globalCss += `\n\n/* Not global.css found, automatically added minimal Tailwind import */\n@import "tailwindcss";`;
    }

    gGlobalCssFilePath = jk_fs.join(rootDir, "global.gen.css");
    await jk_fs.writeTextToFile(gGlobalCssFilePath, globalCss);

    return gGlobalCssContent = globalCss;
}
//
let gGlobalCssContent: string | undefined;

/**
 * Returns the path to the global compiled CSS file.
 * Will create the file if it doesn't exist.
 */
export async function getGlobalCssFilePath_createIfDontExists() {
    let filePath = getGlobalCssFilePath();
    if (g_globalCssFileExist) return filePath;

    if (!await jk_fs.isFile(filePath)) {
        let fileContent = await getMergedGlobalCssFileContent();
        await jk_fs.writeTextToFile(filePath, fileContent);
        g_globalCssFileExist = true;
    }

    return filePath;
}
//
let g_globalCssFileExist = false; 

/**
 * Returns the path to the global compiled CSS file.
 */
export function getGlobalCssFilePath() {
    if (!gGlobalCssFilePath) {
        gGlobalCssFilePath = jk_fs.join(jk_fs.dirname(jk_app.findRequiredPackageJson()), "global.gen.css");
    }

    return gGlobalCssFilePath;
}
//
let gGlobalCssFilePath: string | undefined;

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

async function tailwindCompile(tailwindPlugin: postcss.AcceptedPlugin, fromDir: string): Promise<string|undefined> {
    let plugins: postcss.AcceptedPlugin[] = [tailwindPlugin];
    let globalCssContent = await getMergedGlobalCssFileContent();
    const processor = postcss(plugins);

    try {
        let css = "";

        await execConsoleMuted(async () => {
            const result = await processor.process(globalCssContent, {
                // Setting 'from' allows resolving correctly the node_modules resolving.
                from: fromDir
            });

            css = result.css;
        });

        return css;
    }
    catch (e: any) {
        console.log(jk_term.textBgRed("JopiJS - Failed compiling global.css file"));
        console.log("> File: " + jk_fs.pathToFileURL(getGlobalCssFilePath()));

        if (e.name==="CssSyntaxError") {
            console.log("> Tailwind say " + jk_term.textRed(e.reason));
        }

        return undefined;
    }
}