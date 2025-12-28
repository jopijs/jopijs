import * as sass from "sass";
import fs from "node:fs/promises";
import postcssModules from "postcss-modules";
import postcss from "postcss";
import * as jk_crypto from "jopi-toolkit/jk_crypto";
import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_fs from "jopi-toolkit/jk_fs";
import path from "node:path";
import tailwindPostcss from "@tailwindcss/postcss";
import type {BundlerConfig, CreateBundleParams} from "jopijs";

let gGlobalCssContent: string | undefined;

/**
 * Remove '@import' already found into globalCss
 */
function removeImportDoublon(globalCss: string, content: string): string {
    let foundImports: Record<string, boolean> = {};

    for (let line of globalCss.split("\n")) {
        let tmp = line.trim();

        if (tmp.startsWith("@import")) {
            foundImports[tmp] = true;
        }
    }

    let lines = [];

    for (let line of content.split("\n")) {
        let tmp = line.trim();

        if (tmp.startsWith("@import")) {
            if (foundImports[tmp]) continue;
            foundImports[tmp] = true;
        }

        lines.push(line);
    }

    return lines.join("\n");
}

export async function getGlobalCssFileContent(config: BundlerConfig): Promise<string> {
    if (gGlobalCssContent) return gGlobalCssContent;

    if (config.tailwind.globalCssContent) {
        return config.tailwind.globalCssContent;
    }

    if (config.tailwind.globalCssFilePath) {
        if (!await jk_fs.isFile(config.tailwind.globalCssFilePath)) {
            throw new Error(`Tailwind - File not found where resolving 'global.css': ${config.tailwind.globalCssFilePath}`);
        }

        return jk_fs.readTextFromFile(config.tailwind.globalCssFilePath);
    }

    let rootDir = jk_fs.dirname(jk_app.findPackageJson());
    let dirItems = await jk_fs.listDir(jk_fs.join(rootDir, "src"));

    let globalCss = `/* Warning: generated file */`;

    let coreGlobalCssPath = jk_fs.join(rootDir, "global.css");

    if (await jk_fs.isFile(coreGlobalCssPath)) {
        let content = await jk_fs.readTextFromFile(coreGlobalCssPath);
        globalCss += "\n\n/* --- Compiled from ./global.css --- */\n\n" + content;
    }

    coreGlobalCssPath = jk_fs.join(rootDir, "src/global.css");

    if (await jk_fs.isFile(coreGlobalCssPath)) {
        let content = await jk_fs.readTextFromFile(coreGlobalCssPath);
        globalCss += "\n\n/* --- Compiled from ./src/global.css --- */\n\n" + content;
    }

    for (let item of dirItems) {
        if (!item.isDirectory) continue;
        if (!item.name.startsWith("mod_")) continue;
        let globalCssPath = jk_fs.join(item.fullPath, "global.css");

        let content = await jk_fs.readTextFromFile(globalCssPath);

        if (content) {
            content = removeImportDoublon(globalCss, content);

            globalCss += `\n\n/* --- Compiled from ./src/${item.name}/global.css --- */`
            globalCss += "\n" + content;
        }
    }

    await jk_fs.writeTextToFile(jk_fs.join(rootDir, "global.compiled.css"), globalCss);

    return gGlobalCssContent = globalCss;
}

export async function applyTailwindProcessor(params: CreateBundleParams): Promise<void> {
    function append(text: string) {
        return fs.appendFile(outFilePath, "\n" + text + "\n", "utf-8");
    }

    let sourceFiles = params.entryPoints;
    let genDir = params.genDir;

    // >>> Tailwind transform

    if (params.singlePageMode) {
        genDir = jk_fs.join(genDir, params.pageKey!);
        sourceFiles = [genDir + ".jsx"];
    }

    const outFilePath = path.resolve(genDir, "tailwind.css");

    if (await jk_fs.isFile(outFilePath)) {
        await jk_fs.unlink(outFilePath);
    }

    // Assure the file exists.
    await jk_fs.writeTextToFile(outFilePath, "");

    let postCss = await applyPostCss(params, sourceFiles);
    if (postCss) await append(postCss);
}

/**
 * Compile a CSS or SCSS file to a JavaScript file.
 */
export async function compileCssModule(filePath: string): Promise<string> {
    // Occurs when it's compiled with TypeScript.
    if (!await jk_fs.isFile(filePath)) {
        let source = jk_app.searchSourceOf(filePath)!;
        if (!source) throw new Error(`Source not found for file not found: ${filePath}`);
        filePath = source;
    }

    const ext = path.extname(filePath).toLowerCase();

    let css: string;
    let fromPath = filePath;

    if (ext === ".scss") {
        // Compile SCSS to CSS
        css = scssToCss(filePath);
        fromPath = filePath.replace(/\.scss$/i, '.css');
    } else {
        css = await fs.readFile(filePath, 'utf-8');
    }

    // Process with PostCSS and css-modules
    let knownClassNames: Record<string, string> = {};

    try {
        const plugins = [
            postcssModules({
                // The format of the classnames.
                generateScopedName: '[name]__[local]',
                localsConvention: 'camelCaseOnly',

                // Allow capturing the class names.
                getJSON: (_cssFileName: string, json: Record<string, string>) => {
                    knownClassNames = json || {};
                }
            })
        ];

        let res = await postcss(plugins).process(css, {from: fromPath, map: false});
        css = res.css;

    } catch (e: any) {
        console.warn("jopi-loader - PostCSS processing failed:", e?.message || e);
        throw e;
    }

    knownClassNames.__CSS__ = css;
    knownClassNames.__FILE_HASH__ = jk_crypto.md5(filePath);

    // Here __TOKENS__ contain something like {myLocalStyle: "LocalStyleButton__myLocalStyle___n1l3e"}.
    // The goal is to resolve the computed class name and the original name.

    if (process.env.JOPI_BUNLDER_ESBUILD) {
        return `export default ${JSON.stringify(knownClassNames)};`;
    }

    return `export default ${JSON.stringify(knownClassNames)};`
}

/**
 * Generate Tailwind CSS file a list of source files and returns the CSS or undefined.
 */
async function applyPostCss(params: CreateBundleParams, sourceFiles: string[]): Promise<string|undefined> {
    if (!sourceFiles.length) return "";

    const bundlerConfig = params.config;

    let plugins: postcss.AcceptedPlugin[] = [];

    let config = bundlerConfig.tailwind.config || {};
    if (!config.content) config.content = sourceFiles;
    else config.content = [...sourceFiles, ...(config.content as string[])];

    if (bundlerConfig.tailwind.extraSourceFiles) {
        if (!config.content) config.content = [];
        config.content = [...config.content, ...bundlerConfig.tailwind.extraSourceFiles];
    }

    let tailwindPlugin = bundlerConfig.tailwind.disable ? undefined : tailwindPostcss({config} as any);

    if (bundlerConfig.postCss.initializer) {
        plugins = bundlerConfig.postCss.initializer(sourceFiles, tailwindPlugin);
    } else if (tailwindPlugin) {
        plugins = [tailwindPlugin];
    } else {
        return undefined;
    }

    if (!plugins.length) return undefined;

    let globalCssContent = await getGlobalCssFileContent(bundlerConfig);

    try {
        const processor = postcss(plugins);

        const result = await processor.process(globalCssContent, {
            // Setting 'from' allows resolving correctly the node_modules resolving.
            from: params.outputDir
        });

        return result.css;
    }
    catch (e: any) {
        console.error("Error while compiling for Tailwind:", e);
        return undefined;
    }
}

function scssToCss(filePath: string): any {
    const res = sass.compile(filePath, { style: 'expanded' });
    return res.css.toString();
}