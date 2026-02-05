// Is called by "nodejs_import.mjs" using the new nodejs loader api.
// Here the script is executed into another thread than the main javascript thread.
// It's the new nodejs loader api ... which has some bug, it's why we use the old one in "nodejs_loader.mjs".

import { doNodeJsLoad, doNodeJsResolve } from "jopijs/loader-tools";

export async function resolve(specifier, context, nextResolve) {
    return doNodeJsResolve(specifier, context, nextResolve);
}

export async function load(url, context, nextLoad) {
    return doNodeJsLoad(url, context, nextLoad);
}