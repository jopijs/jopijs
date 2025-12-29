import {compileCssModule} from "jopijs/postcss";
import {supportedExtensionToType} from "./rules.ts";
import path from "node:path";
import fs from "node:fs/promises";

import * as jk_fs from "jopi-toolkit/jk_fs";
import {getVirtualUrlForFile} from "./virtualUrl.ts";
import {getWebSiteConfig} from "jopijs/coreconfig";

export interface TransformResult {
    text: string;
    type: "js"|"text"
}

export async function transformFile(filePath: string, options: string): Promise<TransformResult> {
    let text: string;

    if (filePath.endsWith(".json")) {
        // .json must be ignored with bun.js since some libraries use require and not import.
        // The matter is that the generated code can't be compatible with import and require
        // at the same time.
        //
        // Moreover, bun.js native implementation seems way faster.
        //
        text = await transform_json(filePath);
    }
    else if (options=="raw") {
        text = await transform_raw(filePath);
    }
    else if (options==="inline") {
        text = await transform_inline(filePath);
    }
    else if (filePath.endsWith(".module.css") || (filePath.endsWith(".module.scss"))) {
        text = await transform_cssModule(filePath);
    }
    else if (filePath.endsWith(".css") || (filePath.endsWith(".scss"))) {
        text = await transform_css(filePath);
    }
    else {
        text = await transform_filePath(filePath);
    }

    return {text, type: "js"};
}

async function transform_cssModule(sourceFilePath: string) {
    return await compileCssModule(sourceFilePath);
}

/**
 * Allow getting the file path of the CSS.
 * Here we mimic Bun.js behaviors.
 *
 * To know: Bun.js doesn't allow catching .css file anymore.
 *          It's why here we are node.js only.
 */
async function transform_css(sourceFilePath: string) {
    sourceFilePath = jk_fs.resolve(sourceFilePath);
    return `export default ${JSON.stringify(sourceFilePath)};`;
}

/**
 * This function is called each time we import a resource.
 *
 * It will:
 * - Inline the resource as a data-url if it's small enough and of the good type (image).
 * - Return a virtual URL if the resource is not inlined.
 *
 * This virtual URL allows responding to the fact that we don't know
 * the final URL of the resource until the bundling is done since here
 * the processing of import is the very first step done by Node/Bun.js when starting.
 */
async function transform_filePath(sourceFilePath: string) {
    if (await canInline(sourceFilePath)) {
        return transform_inline(sourceFilePath);
    }

    let virtualUrl = getVirtualUrlForFile(sourceFilePath);

    if (!virtualUrl?.url) {
        return `const __PATH__ = ${JSON.stringify(virtualUrl?.sourceFile)}; export default __PATH__;`
    }

    if (process.env.JOPI_BUNLDER_ESBUILD) {
        return `const __URL__ = ${JSON.stringify(virtualUrl.url)}; export default __URL__;`
    }

    return `const __URL__ = ${JSON.stringify(virtualUrl.url)};
if (typeof(global)!=="undefined") {
    if (global.jopiAddVirtualUrl) global.jopiAddVirtualUrl(${JSON.stringify(virtualUrl)}, false);
} else {
    if (window.jopiAddVirtualUrl) window.jopiAddVirtualUrl(${JSON.stringify(virtualUrl)}, false);
}
export default __URL__;`
}

/**
 * The list of file extensions which can be inlined.
 */
const gCanInlineExtensions = [".png", ".jpg", ".jpeg", ".gif", ".svg"];

/**
 * Check if the file can be inlined.
 * It must be of the good type (see gCanInlineExtensions).
 * And have a size inferior to the max size allowed.
 */
async function canInline(filePath: string): Promise<boolean> {
    let idx = filePath.lastIndexOf(".");
    if (idx===-1) return false;

    let ext = filePath.substring(idx);
    if (!gCanInlineExtensions.includes(ext)) return false;

    const config = getWebSiteConfig();
    let maxSize = config.inlineMaxSize_ko;

    let fileSize = Math.trunc(await jk_fs.getFileSize(filePath) / 1024);
    return fileSize <= maxSize;


}

async function transform_json(filePath: string) {
    const resText = await jk_fs.readTextFromFile(filePath);
    return `export default ${resText};`;
}

async function transform_raw(filePath: string) {
    let ext = path.extname(filePath);
    let type = supportedExtensionToType[ext];
    if (!type) type = "text";

    let resText: string;

    if ((type==="text")||(type==="css")) {
        resText = await jk_fs.readTextFromFile(filePath);
    } else {
        const buffer: Buffer = await fs.readFile(filePath);

        // Here there is no the prefix "data:image/jpeg;base64".
        // It's the difference with the "?inline" option.
        //
        resText = buffer.toString('base64');
    }

    return `export default  ${JSON.stringify(resText)};`
}

async function transform_inline(filePath: string) {
    let ext = path.extname(filePath);
    let type = supportedExtensionToType[ext];
    if (!type) type = "text";

    let resText: string;

    if ((type==="text")||(type==="css")) {
        resText = await jk_fs.readTextFromFile(filePath);
    } else {
        /*const config = getPackageJsonConfig();
        let maxSize = config ? config.inlineMaxSize_ko : INLINE_MAX_SIZE_KO;

        let fileSize = Math.trunc(await jk_fs.getFileSize(filePath) / 1024);

        if (fileSize > maxSize) {
            return transform_filePath(filePath);
        }*/

        const buffer: Buffer = await fs.readFile(filePath);
        const mimeType = jk_fs.getMimeTypeFromName(filePath);

        // Here there is no the prefix "data:image/jpeg;base64".
        // It's the difference with the "?inline" option.
        //
        resText = buffer.toString('base64');
        resText = `data:${mimeType};base64,${resText}`;
    }

    return `export default ${JSON.stringify(resText)};`
}