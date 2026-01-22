import {isBunJS} from "jopi-toolkit/jk_what";

function toFlatList(rec: Record<string, string[]>): string[] {
    let res: string[] = [];

    for (let group in rec) {
        res = [...res, ...rec[group]]
    }

    return res;
}

function invertKeys(rec: Record<string, string[]>): Record<string, string> {
    const res: Record<string, string> = {};

    for (let key in rec) {
        let group = rec[key];
        group.forEach(e => {res[e] = key});
    }

    return res;
}

function patchForJsEngine(value: Record<any, any>) {
    // Bun.js handle JSON specially, with care for import/require differences.
    if (!isBunJS) {
       value.text.push(".json");
    }

    return value;
}

export const supportedImageType = [".jpg", ".png", ".jpeg", ".gif", ".webp", ".woff", ".woff2", ".ttf", ".avif", ".ico"];

const supportedExtensionsByGroup = patchForJsEngine({
    css: [".css", ".scss"],
    binary: supportedImageType,

    //.json added here by patchForJsEngine if not bun.js
    text: [".txt", ".svg", ".glsl", /*".json" added only for node.js */]
});

export const supportedExtensions = toFlatList(supportedExtensionsByGroup);
export const supportedExtensionToType = invertKeys(supportedExtensionsByGroup);

export const supportedExtensionsRegExp = new RegExp(`(${supportedExtensions.map(ext => ext.replace('.', '\\.')).join('|')})(?:\\?.*)?$`);

export const supportedExtensionsReg_images = new RegExp(`(${supportedImageType.map(ext => ext.replace('.', '\\.')).join('|')})(?:\\?.*)?$`);
