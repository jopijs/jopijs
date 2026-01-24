export function selectLang(lang: string, item?: string | Record<string, string>, defaultValue?: string|undefined): string|undefined  {
    if (item !== undefined) {
        if (typeof item === "string") return item;
        if (item[lang]) return item[lang];
    }

    return defaultValue;
}