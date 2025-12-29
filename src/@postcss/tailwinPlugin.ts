import postcss from "postcss";
import tailwindPostcss from "@tailwindcss/postcss";
import * as jk_fs from "jopi-toolkit/jk_fs";
import {getCodeGenSourceDir} from "jopijs/coreconfig";

/**
 * Get a singleton instance of the Tailwind CSS plugin
 *
 * @param scanFiles
 *     If true, returns a plugin that will scan the source code
 *          to find which Tailwind rules must be included in the final result.
 *     If false, returns a plugin without scanning
 *          and executing way faster.
 */
export function getTailwindPlugin(scanFiles: boolean): postcss.AcceptedPlugin {
    if (scanFiles) {
        if (gTailwindPlugin_scanFiles) return gTailwindPlugin_scanFiles;

        const filesToScan = getTailwindFilesToScan();
        let config: { content: string[] } = {content: filesToScan};
        return gTailwindPlugin_scanFiles = tailwindPostcss({config} as any);

    } else {
        if (gTailwindPlugin_noScanFiles) return gTailwindPlugin_noScanFiles;
        return gTailwindPlugin_noScanFiles = tailwindPostcss();
    }
}
//
let gTailwindPlugin_scanFiles: postcss.AcceptedPlugin | undefined;
let gTailwindPlugin_noScanFiles: postcss.AcceptedPlugin | undefined;

function getTailwindFilesToScan(): string[] {
    if (!gTailwindFilesToScan) {
        let filePath = jk_fs.join(getCodeGenSourceDir(), "tailwind-files.json");
        let res = jk_fs.readJsonFromFileSync<string[]>(filePath);
        if (!res) res = [];

        gTailwindFilesToScan = res;
    }

    return gTailwindFilesToScan;
}
//
let gTailwindFilesToScan: string[] | undefined;
