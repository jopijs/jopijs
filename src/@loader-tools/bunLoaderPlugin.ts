import {supportedExtensionsRegExp} from "./rules.ts";
import {transformFile} from "./transform.ts";
import {installEsBuildPlugins} from "./esBuildPlugin.js";

export const bunLoaderPlugin: Bun.BunPlugin = {
        name: "jopi-loader",

        setup(build) {
        // For CSS Modules and imports with ?inline and ?raw
        installEsBuildPlugins(build, "bun");

        // For .css/.scss/.png/.txt/...
        build.onLoad({filter: supportedExtensionsRegExp}, async ({path}) => {
            let idx = path.indexOf("?");
            let options = "";

            if (idx !== -1) {
                options = path.substring(idx + 1);
                path = path.substring(0, idx);
            }

            const res = await transformFile(path, options);

            return {
                contents: res.text,
                loader: "js",
            };
        });
    }
};