import {resolveNodeJsAlias} from "jopijs/loader-tools"

export async function resolve(specifier, context, nextResolve) {
    return resolveNodeJsAlias(specifier, context, nextResolve);
}