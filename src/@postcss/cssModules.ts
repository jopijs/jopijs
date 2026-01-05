import * as sass from "sass";
import fs from "node:fs/promises";
import postcssModules from "postcss-modules";
import postcss from "postcss";
import * as jk_crypto from "jopi-toolkit/jk_crypto";
import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_term from "jopi-toolkit/jk_term";
import path from "node:path";
import {getTailwindPlugin} from "./tailwinPlugin.ts";
import {execConsoleMuted} from "./tools.ts";
import {getGlobalCssFilePath_createIfDontExists} from "./globalCss.ts";
import {getWebSiteConfig} from "jopijs/coreconfig";

/**
 * Compile a CSS or SCSS file to a JavaScript file.
 *
 * Is called from EsBuild bundler.
 * But also Bun.js and Node.js bundler.
 */
export async function compileCssModule(filePath: string): Promise<string> {
    debugger;
    // Occurs when it's compiled with TypeScript.
    if (!await jk_fs.isFile(filePath)) {
        let source = jk_app.searchSourceOf(filePath)!;
        if (!source) throw new Error(`Source not found for file not found: ${filePath}`);
        filePath = source;
    }

    const ext = path.extname(filePath).toLowerCase();

    let css: string;

    if (ext === ".scss") {
        // Compile SCSS to CSS
        css = scssToCss(filePath);
    } else {
        css = await fs.readFile(filePath, 'utf-8');
    }

    const fromPath = jk_fs.dirname(filePath);

    // Process with PostCSS and css-modules
    let knownClassNames: Record<string, string> = {};

    const plugins: postcss.AcceptedPlugin[] = [];

    // Must use Tailwind preprocessor.
    if (css.includes("@apply")) {
        let tailwindPlugin = getTailwindPlugin(false);
        let refHeader = await getGlobalCssFilePath_createIfDontExists();
        refHeader = "@reference " + JSON.stringify(refHeader) + ";";
        css = refHeader + "\n\n" + css;

        plugins.push(tailwindPlugin);
    }

    plugins.push(postcssModules({
        // The format of the classnames.
        generateScopedName: '[name]__[local]',
        localsConvention: 'camelCaseOnly',

        // Allow capturing the class names.
        getJSON: (_cssFileName: string, json: Record<string, string>) => {
            knownClassNames = json || {};
        }
    }));

    try {
        // Mute the console to avoid an unreadable Tailwind error message in case of error.
        //
        await execConsoleMuted(async () => {
            let res = await postcss(plugins).process(css, {from: fromPath, map: false});
            css = res.css;
        });
    } catch (e: any) {
        console.log(jk_term.textBgRed("JopiJS - Failed compiling CSS modules"));
        console.log("> File: " + jk_fs.pathToFileURL(filePath));

        if (e.name==="CssSyntaxError") {
            console.log("> Tailwind say " + jk_term.textRed(e.reason));
        }

        css = "";
    }

    knownClassNames.__CSS__ = css;
    knownClassNames.__FILE_HASH__ = jk_crypto.md5(filePath);

    if (!gWebSiteConfig.isProduction) {
        knownClassNames.__FILE_PATH__ = filePath;
    }

    return `export default ${JSON.stringify(knownClassNames)};`
}

function scssToCss(filePath: string): any {
    const res = sass.compile(filePath, { style: 'expanded' });
    return res.css.toString();
}

const gWebSiteConfig = getWebSiteConfig();
