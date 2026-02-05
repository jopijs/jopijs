// Is referenced by jopin when execting JopiJS with nodejs.
// We have to commande line, executed by jopin:
// node --import jopijs/loader/nodejs_import.mjs --loader jopijs/loader/nodejs_loader.mjs

import * as NodeModule from 'node:module';
import {isNodeJS} from "jopi-toolkit/jk_what";

const __JOPI_LOADER_REGISTERED__ = Symbol.for('jopi-loader:registered');
const __g = globalThis;

if (!__g[__JOPI_LOADER_REGISTERED__]) {
    __g[__JOPI_LOADER_REGISTERED__] = true;

    if (isNodeJS) {
        NodeModule.register(new URL('./nodejs_import_done.mjs', import.meta.url));
    }
}