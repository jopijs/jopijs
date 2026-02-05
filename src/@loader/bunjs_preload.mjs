// Is referenced by bunjs config file "bunfig.toml".
// preload = ["jopijs/loader/bunjs_preload"]

import { installBunJsLoader } from "jopijs/loader-tools";

const __JOPI_LOADER_REGISTERED__ = Symbol.for('jopi-loader:registered');
const __g = globalThis;

if (!__g[__JOPI_LOADER_REGISTERED__]) {
    __g[__JOPI_LOADER_REGISTERED__] = true;
    installBunJsLoader();
}