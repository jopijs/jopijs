import {supportedExtensionsRegExp} from "./rules.ts";
import {transformFile} from "./transform.ts";
import {installEsBuildPlugins} from "./esBuildPlugin.js";
import * as jk_app from "jopi-toolkit/jk_app";
import path from "node:path";

export const bunLoaderPlugin: Bun.BunPlugin = {
        name: "jopi-loader",

        setup(build) {
            // For CSS Modules and imports with ?inline and ?raw
            installEsBuildPlugins(build, "bun");

            build.onResolve({filter: supportedExtensionsRegExp}, async (args) => {
                let importPath = args.path;
                let query = "";

                const idx = importPath.lastIndexOf("?");
                if (idx !== -1) {
                    query = importPath.substring(idx);
                    importPath = importPath.substring(0, idx);
                }

                let absolutePath: string;

                if (importPath.startsWith('.')) {
                    absolutePath = path.resolve(path.dirname(args.importer), importPath);
                }
                else if (path.isAbsolute(importPath)) {
                    absolutePath = importPath;
                }
                else {
                    return undefined;
                }

                const srcPath = jk_app.requireSourceOf(absolutePath);

                return {
                    path: srcPath + query
                }
            });

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