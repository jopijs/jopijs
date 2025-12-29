import postcss from "postcss";
import tailwindPostcss from "@tailwindcss/postcss";
import * as jk_fs from "jopi-toolkit/jk_fs";
import {getCodeGenSourceDir} from "jopijs/coreconfig";

export function getTailwindPlugin(): postcss.AcceptedPlugin {
    if (!gTailwindPlugin) {
        const filesToScan = getTailwindFilesToScan();
        let config: { content: string[] } = {content: filesToScan};
        gTailwindPlugin = tailwindPostcss({config} as any);
    }
    return gTailwindPlugin;
}
//
let gTailwindPlugin: postcss.AcceptedPlugin | undefined;

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
