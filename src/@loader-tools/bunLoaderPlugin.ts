import {installEsBuildPlugins} from "./esBuildPlugin.js";

export const bunLoaderPlugin: Bun.BunPlugin = {
        name: "jopi-loader",

        setup(build) {
            // For CSS Modules and imports with ?inline and ?raw
            installEsBuildPlugins(build, "bun");
        }
};