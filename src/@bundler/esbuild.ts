import esbuild, {type BuildResult} from "esbuild";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as n_what from "jopi-toolkit/jk_what";
import type {CreateBundleParams} from "jopijs/core";
import {jopiReplaceText, jopiLoaderPlugin, jopiDetectRebuild} from "./plugins.ts";
import {tailwindTransformGlobalCss} from "jopijs/postcss";
import {getWebSiteConfig} from "jopijs/coreconfig";

const gIsProduction = getWebSiteConfig().isProduction;

export interface EsBuildParams extends CreateBundleParams {
    dontEmbed: string[]|undefined;
}

export async function esBuildBundle(params: EsBuildParams) {
    // To know: will generate:
    // * Some files out/page_xxxx.js, where each page is an "page.tsx".
    // * Some files out/page_xxxx.css with the CSS specific to this page.

    const buildOptions: esbuild.BuildOptions = {
        entryPoints: params.entryPoints,

        bundle: true,
        outdir: params.outputDir,
        external:  params.dontEmbed,

        // Allows generating relative url
        // without the full website name.
        //
        publicPath: "/_bundle/",

        platform: 'browser',
        format: 'esm',
        target: "es2020",

        splitting: true,

        plugins: [
            jopiLoaderPlugin,
            jopiReplaceText(),
        ],

        loader: {
            ".css": "css",
            ".scss": "css",

            // Polices
            '.woff': 'file',
            '.woff2': 'file',
            '.ttf': 'file',
            '.eot': 'file',

            // Images
            '.jpg': 'file',
            '.jpeg': 'file',
            '.png': 'file',
            '.svg': 'file',
            '.gif': 'file',
            '.webp': 'file',

            // Media
            '.mp3': 'file',
            '.mp4': 'file',

            // Others
            '.html': 'text',
            '.md': 'text'
        },

        minify: gIsProduction,
        sourcemap: !gIsProduction,

        // Will trigger an error on collision detection.
        allowOverwrite: false,

        // Produce metadata about the build.
        metafile: true
    };

    await tailwindTransformGlobalCss(params);

    const context = await esbuild.context(buildOptions);
    let result: BuildResult = await context.rebuild();

    // >>> Resolve virtual urls

    // The url is formed before the bundle is done.
    // It's why we don't know the final url of the resource
    // which is a processed and transformed resource, especially
    // for CSS files, which content is resolving his dependencies.

    if (params.virtualUrlMap) {
        const allMeta = result.metafile!;

        if (allMeta.outputs) {
            for (const outputFilePath in allMeta.outputs) {
                const ext = jk_fs.extname(outputFilePath);
                if ([".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs"].includes(ext)) continue;

                const metaValue = allMeta.outputs[outputFilePath];

                if (metaValue.inputs) {
                    const inputs = metaValue.inputs;

                    for (let inputFilePath of Object.keys(inputs)) {
                        const key = jk_fs.resolve(inputFilePath);
                        const entry = params.virtualUrlMap.find(e => e.sourceFile === key);

                        // Don't override if already set because the next
                        // entry can be a resource using our entry, so it
                        // will be overridden.
                        //
                        if (entry && !entry.bundleFile) {
                            entry.bundleFile = jk_fs.resolve(outputFilePath);
                        }
                    }
                }
            }
        }
    }
}