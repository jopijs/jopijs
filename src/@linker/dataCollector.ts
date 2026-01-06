import {CodeGenWriter} from "./engine.ts";
import * as jk_fs from "jopi-toolkit/jk_fs";

/**
 * Allow knowing the whole list of UI components (including pages).
 * Will be used to build a list for Tailwind CSS files to scanne.
 */
export function collector_declareUiComponent(fileAbsPath: string) {
    if (fileAbsPath.startsWith(g_cwd)) fileAbsPath = fileAbsPath.slice(g_cwd.length + 1);
    g_uiComponents.push(fileAbsPath);
}

export function collector_begin() {
    g_uiComponents = [];
}

export async function collector_end(writer: CodeGenWriter) {
    const json = JSON.stringify(g_uiComponents, null, 4);
    await jk_fs.writeTextToFile(jk_fs.join(writer.dir.output_dist, "tailwind-files.json"), json);
    await jk_fs.writeTextToFile(jk_fs.join(writer.dir.output_src, "tailwind-files.json"), json);

    g_uiComponents = [];
}

let g_cwd = process.cwd();
let g_uiComponents: string[] = [];