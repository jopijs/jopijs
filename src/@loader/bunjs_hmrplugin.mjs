// Is referenced by bunjs config file "bunfig.toml".
/* [serve.static]
plugins = [
    # Allow compiling Tailwind.
    "bun-plugin-tailwind",
    
    
    # Add jopijs requirements.
    "jopijs/loader/bunjs_hmrplugin.mjs"
]*/

import fs from "node:fs/promises";
import path from "node:path";
import {installEsBuildPlugins} from "jopijs/loader-tools";

// ******************************************************************************************************
// Loaded from bunfig.toml file to when using HMR mode.
// ******************************************************************************************************

const myPlugin = {
    name: "jopi-replace-text",

    setup(build) {
        build.onLoad({filter: /\.(tsx|ts|js|jsx)$/}, async ({path: p2}) => {
            const oldContent = await fs.readFile(p2, 'utf8');
            let newContent = oldContent.replaceAll("jBundler_ifServer", "jBundler_ifBrowser");
            newContent = newContent.replaceAll("JOPI_BUNDLER_UI_MODE", "ReactHMR");

            const loader = path.extname(p2).toLowerCase().substring(1);
            return {contents: newContent, loader: loader};
        });

        installEsBuildPlugins(build, "bun-react-hmr");
    }
}

export default myPlugin;