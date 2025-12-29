import * as sass from "sass";
import fs from "node:fs/promises";
import postcssModules from "postcss-modules";
import postcss from "postcss";
import * as jk_crypto from "jopi-toolkit/jk_crypto";
import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_fs from "jopi-toolkit/jk_fs";
import path from "node:path";

/**
 * Compile a CSS or SCSS file to a JavaScript file.
 *
 * Is called from EsBuild bundler.
 * But also Bun.js and Node.js bundler.
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

    return `export default ${JSON.stringify(knownClassNames)};`
}

function scssToCss(filePath: string): any {
    const res = sass.compile(filePath, { style: 'expanded' });
    return res.css.toString();
}