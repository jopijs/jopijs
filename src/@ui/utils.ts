import type { Translatable } from "jopi-toolkit/jk_tools";

export function selectLang(lang: string, item?: Translatable, defaultValue?: string | undefined): string | undefined  {
    if (item !== undefined) {
        if (typeof item === "string") return item;
        if (item[lang]) return item[lang];
    }

    return defaultValue;
}