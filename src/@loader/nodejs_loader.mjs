// Is referenced by jopin when execting JopiJS with nodejs.
// We have to commande line, executed by jopin:
// node --import jopijs/loader/nodejs_import.mjs --loader jopijs/loader/nodejs_loader.mjs

import { resolveNodeJsAlias } from "jopijs/loader-tools"

// Here it's sync and executing in the same thread as our app javascript.
// It's the old nodejs loader api, which is deprecated.
// But the new one has bug. It's why whe use the old one and the new one.
//
export async function resolve(specifier, context, nextResolve) {
    return resolveNodeJsAlias(specifier, context, nextResolve);
}