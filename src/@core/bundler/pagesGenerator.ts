import * as jk_events from "jopi-toolkit/jk_events";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_crypto from "jopi-toolkit/jk_crypto";
import {getBrowserInstallScript} from "jopijs/linker";
import {getBrowserRefreshScript, isBrowserRefreshEnabled, isSinglePageMode, isReactHMR} from "jopijs/loader-client";
import {getGlobalCssFileContent} from "jopijs/bundler";
import type {CreateBundleParams} from "./bundler.ts";

// *********************************************************************************************************************
// The goal of this file is to generate the individual pages required for each page found in the root (page.tsx).
// *********************************************************************************************************************


// This event is called when a new page is found.
// Here we will fill a map "page file path" --> route.
//
jk_events.addListener("@jopi.route.newPage", async ({route, filePath}: {route: string, filePath: string}) => {
    // filePath is the path to the source file.
    filePath = jk_fs.resolve(filePath);
    gPageSourceFileToRoute[filePath] = route;

    let pageKey = "page_" + jk_crypto.fastHash(route);
    gPageKeyToRoute[pageKey] = route;
    gPageKeyToSourceFile[pageKey] = filePath;
});

// This event is called when creating the bundled is creating.
//
// Here we will:
// - Generate the file named "page_xxxx.js" for each page, which will import the real page.
//      Doing this allows enforcing the name of the output produced.
// - Add this file to EsBuild entryPoints to build it with shared resources.
// - It will also generate a "page_xxxx.html" for Bun.js / React HMR.
//
jk_events.addListener("@jopi.bundler.beforeCreateBundle", rebuildPages);
jk_events.addListener("@jopi.bundler.beforeCreateBundleForPage", rebuildPages);

async function rebuildPages(p: CreateBundleParams) {
    async function buildPage(sourceFilePath: string, route: string, pageKey: string) {
        function convertPath(filePath: string): string {
            let relPath = jk_fs.getRelativePath(p.genDir, filePath);
            return jk_fs.win32ToLinuxPath(relPath);
        }

        // Here we save the name without extension.
        gRouteToPageKey[route] = pageKey;

        let txt = REACT_TEMPLATE;
        txt = txt.replace("__PATH__", convertPath(sourceFilePath));
        txt = txt.replace("__INSTALL__",convertPath(installScript));
        txt = txt.replace("__ROUTE__", JSON.stringify(route));
        txt = txt.replace("__OPTIONS__", JSON.stringify({removeTrailingSlashes: p.webSite.mustRemoveTrailingSlashes}));

        txt = txt.replace("__PAGE_EXTRA_PARAMS__", JSON.stringify(p.pageExtraParams));

        if (isReactHMR()) {
            // Bun.js use his own SSE events.
            txt = txt.replace("__SSE_EVENTS__", "");
        }
        else if (isBrowserRefreshEnabled()) {
            // Node.js require our custom SSE events.
            txt = txt.replace("__SSE_EVENTS__", getBrowserRefreshScript());
        } else {
            // No SSE events if production.
            txt = txt.replace("__SSE_EVENTS__", "");
        }

        if (isReactHMR()) {
            // The uncompiled version of tailwind.
            txt = txt.replace("__EXTRA_IMPORTS__", 'import "./tailwind-hmr.css";');
        } else {
            if (isSinglePageMode()) {
                txt = txt.replace("__EXTRA_IMPORTS__", `import "./${pageKey}/tailwind.css";`);
            } else {
                txt = txt.replace("__EXTRA_IMPORTS__", 'import "./tailwind.css";');
            }
        }

        let scriptFilePath = jk_fs.join(p.genDir, pageKey + ".jsx");
        await jk_fs.writeTextToFile(scriptFilePath, txt);

        txt = HTML_TEMPLATE;

        if (gIsDevMode) {
            txt = txt.replace("__SCRIPT_PATH__", "./" + pageKey + '/' + pageKey + ".jsx");
        } else {
            txt = txt.replace("__SCRIPT_PATH__", "./" + pageKey + ".jsx");
        }

        let htmlFilePath = jk_fs.join(p.genDir, pageKey + ".html");
        await jk_fs.writeTextToFile(htmlFilePath, txt);

        return scriptFilePath;
    }

    const installScript = getBrowserInstallScript();

    if (isReactHMR()) {
        let globalCss = await getGlobalCssFileContent(p.config);
        await jk_fs.writeTextToFile(jk_fs.join(p.genDir, "tailwind-hmr.css"), globalCss);
    }

    if (p.singlePageMode) {
        let route = gPageKeyToRoute[p.pageKey!]
        let sourceFilePath = gPageKeyToSourceFile[p.pageKey!];
        await buildPage(sourceFilePath, route, p.pageKey!);
    } else {
        for (let sourceFilePath in gPageSourceFileToRoute) {
            const route = gPageSourceFileToRoute[sourceFilePath];
            const pageKey = "page_" + jk_crypto.fastHash(route);

            let outFilePath = await buildPage(sourceFilePath, route, pageKey);
            p.entryPoints.push(outFilePath);
        }

        // Is not required anymore.
        gPageSourceFileToRoute = {};
        gPageKeyToRoute = {};
        gPageKeyToSourceFile = {};
    }
}

const HTML_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Dev Mode</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="__SCRIPT_PATH__"></script>
  </body>
</html>`;

const REACT_TEMPLATE = `import React from "react";
import ReactDOM from "react-dom/client";
import {PageContext, PageController_ExposePrivate} from "jopijs/ui";
import C from "__PATH__";
import {UiKitModule, useParams} from "jopijs/uikit";

import installer from "__INSTALL__";
__EXTRA_IMPORTS__

window["__JOPI_ROUTE__"] = __ROUTE__;
window["__JOPI_OPTIONS__"] = __OPTIONS__;

installer(new UiKitModule(undefined, __PAGE_EXTRA_PARAMS__));

function Render(p) {
    const [_, setCount] = React.useState(0);
    p.controller.onRequireRefresh = () => setCount(old => old + 1);
    return <C params={p.params} searchParams={p.searchParams} />;
}

function start() {
    const container = document.body;
    const root = ReactDOM.createRoot(container);
    const params = useParams();
    
    let searchParams;
    const coreSearchParams = new URL(window.location).searchParams;
    
    if (coreSearchParams.toJSON) {
        searchParams = coreSearchParams.toJSON();
    }
    else {
        searchParams = {};
        coreSearchParams.forEach((v,k) => searchParams[k] = v);
    }
    
    const controller = new PageController_ExposePrivate();
    
    root.render(
        <React.StrictMode>
            <PageContext.Provider value={controller}>
                <Render controller={controller} params={params} searchParams={searchParams} />
            </PageContext.Provider>
        </React.StrictMode>
    );
}

__SSE_EVENTS__

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
`;

/**
 * Allow knowing the route from the page file path.
 */
let gPageSourceFileToRoute: Record<string, string> = {};

/**
 * Allow knowing the route from the page key.
 */
let gPageKeyToRoute: Record<string, string> = {};

/**
 * Allow knowing the source file from the page key.
 */
let gPageKeyToSourceFile: Record<string, string> = {};

/**
 * Allow knowing the name of the .js and .css file for a page.
 */
const gRouteToPageKey: Record<string, string> = {};

const gIsDevMode = isSinglePageMode();