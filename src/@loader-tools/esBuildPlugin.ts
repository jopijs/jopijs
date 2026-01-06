import {compileCssModule} from "jopijs/postcss";
import {transformFile} from "./transform.ts";
import {getWebSiteConfig} from "jopijs/coreconfig";
import path from "node:path";
import fs from "node:fs";
import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_fs from "jopi-toolkit/jk_fs";
import {jopiTempDir} from "jopijs/coreconfig";

interface JopiRawContent {
    file: string;
    type: string
}

async function processCssModule(path: string) {
    let jsSource = await compileCssModule(path);

    return {
        contents: jsSource,
        loader: "js",
    };
}

async function processCssFile(path: string) {
    // Warning: is ok with EsBuild but not with Bun.js
    // It's why we don't process Tailwind CSS for direct CSS.
    //
    return {
        contents: await jk_fs.readTextFromFile(path),
        loader: "css",
    };
}

async function inlineAndRawModuleHandler(options: string, resPath: string) {
    // Occurs when it's compiled with TypeScript.
    if (!await jk_fs.isFile(resPath)) {
        resPath = jk_app.requireSourceOf(resPath);
    }

    let res = await transformFile(resPath, options);

    return {
        contents: res.text,
        loader: "js",
    };
}

/**
 * Returns the absolute path of the file, while resolving symlink.
 */
export function resolveAndCheckPath(filePath: string, resolveDir: string): {path?: string, error?: string} {
    let absolutePath: string;

    if (path.isAbsolute(filePath)) {
        absolutePath = filePath;
    } else {
        absolutePath = path.resolve(resolveDir, filePath);
    }

    absolutePath = jk_app.requireSourceOf(absolutePath);

    try {
        fs.accessSync(absolutePath);
        return { path: absolutePath };
    } catch (error) {
        return { error: `Resource not found: ${absolutePath}` };
    }
}

function createJopiRawFile(targetFilePath: string, processType: string): any {
    // Bun.js load doesn't support having an '?' in the path.
    // It's why we do strange things here to process this case.
    //
    // Also, there are strange behaviors that we avoid when using this strategy.

    let options = getWebSiteConfig();
    let tempDir = options?.bundlerOutputDir || path.join(jopiTempDir, "bunjs");
    fs.mkdirSync(tempDir, {recursive: true});

    let fileName = path.resolve(tempDir, (gNextTempFileName++) + ".jopiraw");
    fs.writeFileSync(fileName, JSON.stringify({file: targetFilePath, type: processType}));

    return {
        // The file must exist, otherwise
        // an exception is triggered :-(
        path: fileName
    };
}

export function installEsBuildPlugins(build: Bun.PluginBuilder, who: string) {
    const _isEsBuild = who=="esbuild";
    const isBun_default = who=="bun";
    const isBun_ReactHMR = who=="bun-react-hmr";
    const isBun = isBun_default || isBun_ReactHMR;

    build.onResolve({filter: /\.module\.(css|scss)$/}, (args) => {
        const result = resolveAndCheckPath(args.path, path.dirname(args.importer));

        if (result.error) {
            return {
                errors: [{
                    text: result.error
                }]
            };
        }

        //@ts-ignore
        return createJopiRawFile(result.path!, "cssmodule");
    });


    if (!isBun) {
        build.onResolve({filter: /\.(css|scss)$/}, (args) => {
            let [filePath, _option] = args.path.split('?');
            const result = resolveAndCheckPath(filePath, path.dirname(args.importer));

            if (result.error) {
                return {
                    errors: [{
                        text: result.error
                    }]
                };
            }

            //@ts-ignore
            return createJopiRawFile(result.path!, "css");
        });
    } else {
        // @ts-ignore
        build.onResolve({ filter: /\.(css|scss)$/ }, (args) => {
            // Is usefulle when we have a import "./style.css" from the dist/ folder.
            let [filePath, _option] = args.path.split('?');
            const result = resolveAndCheckPath(filePath, path.dirname(args.importer));

            if (result.error) {
                return {
                    errors: [{
                        text: result.error
                    }]
                };
            }

            // Bun.js don't allows personnalizing css processing.
            // It's why here we only resolved path.
            //
            return {
                path: result.path!
            };
        });
    }

    // @ts-ignore
    build.onResolve({filter: /\?(?:inline|raw)$/}, async (args) => {
        let [filePath, option] = args.path.split('?');

        const result = resolveAndCheckPath(filePath, path.dirname(args.importer));

        if (result.error) {
            return {
                errors: [{
                    text: result.error
                }]
            };
        }

        //@ts-ignore
        return createJopiRawFile(result.path!, "option-" + option);
    });

    // @ts-ignore
    build.onLoad({filter: /\.jopiraw$/},  async (args) => {
        let json = JSON.parse(await jk_fs.readTextFromFile(args.path)) as JopiRawContent;
        await jk_fs.unlink(args.path);

        let filePath = json.file;

        switch (json.type) {
            case "option-inline":
                return inlineAndRawModuleHandler("inline", filePath);
            case "option-raw":
                return inlineAndRawModuleHandler("raw", filePath);
            case "cssmodule":
                return processCssModule(filePath);
            case "css":
                // Note: with Bun we can't override CSS processing.
                // It's why we don't check Tailwind preprocess in CSS.
                // But we do it for CSS-Modules.
                //
                return processCssFile(filePath);
        }
    });
}

let gNextTempFileName = 1;