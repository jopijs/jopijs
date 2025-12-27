import {doNodeJsLoad, doNodeJsResolve} from "jopijs/loader-tools";

export async function resolve(specifier: string, context: any, nextResolve: any) {
    return doNodeJsResolve(specifier, context, nextResolve);
}

// noinspection JSUnusedGlobalSymbols
export async function load(url: string, context: any, nextLoad: any) {
    return doNodeJsLoad(url, context, nextLoad);
}