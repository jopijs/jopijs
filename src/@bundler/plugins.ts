import {type Plugin} from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import {tailwindTransformGlobalCss} from "jopijs/postcss";
import * as jk_events from "jopi-toolkit/jk_events";
import * as jk_fs from "jopi-toolkit/jk_fs";
import type {EsBuildParams} from "./esbuild.ts";
import {installEsBuildPlugins} from "jopijs/loader-tools";
import MagicString from 'magic-string';
import {SourceMapConsumer, SourceMapGenerator} from "source-map";
import {logServer_refresh} from "./_logs.ts";

/**
 * This plugin allows replacing some text entries according to rules.
 */
export function jopiReplaceText__Old(): Plugin {
    async function getExistingSourceMap(filePath: string, source: string): Promise<string | null> {
        const sourceMapCommentMatch = source.match(/\/\/# sourceMappingURL=(.+)$/m);
        if (!sourceMapCommentMatch) return null;

        const sourceMapUrl = sourceMapCommentMatch[1];

        if (sourceMapUrl.startsWith('data:application/json;base64,')) {
            const base64Content = sourceMapUrl.replace('data:application/json;base64,', '');
            return Buffer.from(base64Content, 'base64').toString('utf8');
        } else {
            const sourceMapPath = path.resolve(path.dirname(filePath), sourceMapUrl);
            try {
                return await fs.readFile(sourceMapPath, 'utf8');
            } catch {
                return null;
            }
        }
    }

    return {
        name: "jopi-replace-text",

        setup(build) {
            build.onLoad({ filter: /\.(tsx|jsx|ts|js)$/ }, async (args) => {
                const oldContent = await fs.readFile(args.path, 'utf8');
                let newContent = oldContent.replaceAll("jBundler_ifServer", "jBundler_ifBrowser");
                newContent = newContent.replaceAll("JOPI_BUNDLER_UI_MODE", "default");
                if (newContent === oldContent) return undefined;

                const useSourceMap = !!build.initialOptions.sourcemap;

                if (!useSourceMap) {
                    let loader = path.extname(args.path).toLowerCase().substring(1);
                    return {contents: newContent, loader: loader as 'js' | 'jsx' | 'ts' | 'tsx'};
                }

                const existingSourceMap = await getExistingSourceMap(args.path, oldContent);
                const magic = new MagicString(oldContent, {filename: args.path});
                magic.replaceAll("jBundler_ifServer", "jBundler_ifBrowser");
                magic.replaceAll("JOPI_BUNDLER_UI_MODE", "default");

                const map = magic.generateMap({
                    file: args.path,
                    source: path.basename(args.path),
                    includeContent: true,
                    hires: true
                });

                let finalMap: string;

                // Will merge the existing and final source-map.
                //
                if (existingSourceMap) {
                    const consumerExisting = await new SourceMapConsumer(existingSourceMap);
                    const generator = SourceMapGenerator.fromSourceMap(consumerExisting);

                    const consumerNew = await new SourceMapConsumer(JSON.parse(map.toString()));
                    consumerNew.eachMapping((mapping) => {
                        if (mapping.originalLine != null && mapping.originalColumn != null) {
                            generator.addMapping({
                                source: mapping.source || path.basename(args.path),
                                original: { line: mapping.originalLine, column: mapping.originalColumn },
                                generated: { line: mapping.generatedLine, column: mapping.generatedColumn },
                                name: mapping.name,
                            });
                        }
                    });

                    consumerNew.sources.forEach((source) => {
                        const content = consumerNew.sourceContentFor(source, true);
                        if (content) {
                            generator.setSourceContent(source, content);
                        }
                    });

                    finalMap = JSON.stringify(generator.toJSON());
                    consumerNew.destroy();
                    consumerExisting.destroy();
                } else {
                    finalMap = map.toString();
                }

                newContent = magic.toString() +
                    `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(finalMap).toString('base64')}`;

                let loader = path.extname(args.path).toLowerCase().substring(1);
                return {contents: newContent, loader: loader as 'js' | 'jsx' | 'ts' | 'tsx'};
            });
        }
    };
}

export function jopiReplaceText(): Plugin {
    return {
        name: "jopi-replace-text",

        setup(build) {
            build.onLoad({ filter: /\.(tsx|jsx|ts|js)$/ }, async (args) => {
                const oldContent = await fs.readFile(args.path, 'utf8');
                let newContent = oldContent.replaceAll("jBundler_ifServer", "jBundler_ifBrowser");
                newContent = newContent.replaceAll("JOPI_BUNDLER_UI_MODE", "default");
                if (newContent === oldContent) return undefined;

                let loader = path.extname(args.path).toLowerCase().substring(1);
                return {contents: newContent, loader: loader as 'js' | 'jsx' | 'ts' | 'tsx'};
            });
        }
    };
}

export function jopiDetectRebuild(params: EsBuildParams): Plugin {
    // Allow avoiding behaviors with TypeScript compiler doing some late works.
    //
    let isEnabled = false;
    setTimeout(() => { isEnabled = true }, 2000);

    return {
        name: "jopi-detect-rebuild",

        setup(build) {
            build.onStart(async () => {
                // isEnabled is automatically set to true after 2 seconds.
                // It allows avoiding some behaviors with false calls from EsBuild.
                // (probably caused by the dev-tools, including TypeScript compiler)
                //
                if (!isEnabled) return;

                if (params.singlePageMode) {
                    logServer_refresh.info("Refreshing page " + params.pageRoute);
                }

                // Rebuild Tailwind.
                // - Single page mode: rebuild only the local tailwind.
                // - Global mode: never occurs.
                //
                if (params.requireTailwind) {
                    await tailwindTransformGlobalCss(params);
                }

                if (params.singlePageMode) {
                    // This event will execute Jopi Linker.
                    await jk_events.sendAsyncEvent("@jopi.bundler.watch.beforeRebuild");
                }
            });

            build.onEnd(async () => {
                if (!isEnabled) return;

                if (params.singlePageMode) {
                    // This event will execute trigger the SSE event that refreshes the browser.
                    await jk_events.sendAsyncEvent("@jopi.bundler.watch.afterRebuild");
                }
            });
        }
    }
}

/**
 * Allows managing custom import:
 * * Importing CSS modules (.module.css)
 * * Import with ?raw and ?inline
 */
export const jopiLoaderPlugin: Plugin = {
    name: "jopi-loader",
    setup(build) {
        installEsBuildPlugins(build as unknown as Bun.PluginBuilder, "esbuild")
    },
};