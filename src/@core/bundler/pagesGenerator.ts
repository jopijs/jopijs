import * as jk_events from "jopi-toolkit/jk_events";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_crypto from "jopi-toolkit/jk_crypto";
import { getBrowserInstallScript } from "jopijs/linker";
import { getBrowserRefreshScript } from "jopijs/watcher";
import {getWebSiteConfig} from "jopijs/coreconfig";
import { getMergedGlobalCssFileContent } from "jopijs/postcss";
import type { CreateBundleParams } from "./index.ts";
import type { RouteBindPageParams } from "jopijs/generated";

// *********************************************************************************************************************
// The goal of this file is to generate the individual pages required for each page found in the root (page.tsx).
// *********************************************************************************************************************

type RouteInfos = RouteBindPageParams;

// This event is called when a new page is found.
// Here we will fill a map "page file path" --> route.
//
jk_events.addListener("@jopi.route.newPage", async (p: RouteInfos) => {
    // filePath is the path to the source file.
    p.filePath = jk_fs.resolve(p.filePath);
    gPageSourceFileToRoute[p.filePath] = p;

    let pageKey = "page_" + jk_crypto.fastHash(p.route);
    gPageKeyToRoute[pageKey] = p;
    gPageKeyToSourceFile[pageKey] = p.filePath;
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
    async function buildPage(sourceFilePath: string, routeInfos: RouteInfos, pageKey: string) {
        function convertPath(filePath: string): string {
            let relPath = jk_fs.getRelativePath(p.genDir, filePath);
            return jk_fs.win32ToLinuxPath(relPath);
        }

        // Here we save the name without extension.
        gRouteToPageKey[routeInfos.route] = pageKey;

        let txt = REACT_TEMPLATE;
        txt = txt.replace("__PATH__", convertPath(sourceFilePath));
        txt = txt.replace("__INSTALL__", convertPath(installScript));
        txt = txt.replace("__ROUTE__", JSON.stringify({ route: routeInfos.route, catchAll: routeInfos.attributes.catchAllSlug }));
        txt = txt.replace("__OPTIONS__", JSON.stringify({ removeTrailingSlashes: p.webSite.mustRemoveTrailingSlashes }));

        txt = txt.replace("__PAGE_EXTRA_PARAMS__", JSON.stringify(p.pageExtraParams));

        if (getWebSiteConfig().hasReactHmrFlag) {
            // Bun.js use his own SSE events.
            txt = txt.replace("__SSE_EVENTS__", "");
        }
        else if (getWebSiteConfig().isBrowserRefreshEnabled) {
            // Node.js require our custom SSE events.
            txt = txt.replace("__SSE_EVENTS__", getBrowserRefreshScript());
        } else {
            // No SSE events if production.
            txt = txt.replace("__SSE_EVENTS__", "");
        }

        if (getWebSiteConfig().hasReactHmrFlag) {
            // The uncompiled version of tailwind.
            txt = txt.replace("__EXTRA_IMPORTS__", 'import "./global-hmr.css";');
        } else {
            if (getWebSiteConfig().isSinglePageMode) {
                txt = txt.replace("__EXTRA_IMPORTS__", `import "./${pageKey}/global.css";`);
            } else {
                txt = txt.replace("__EXTRA_IMPORTS__", 'import "./global.css";');
            }
        }

        let scriptFilePath = jk_fs.join(p.genDir, pageKey + ".jsx");
        await jk_fs.writeTextToFile(scriptFilePath, txt);

        txt = HTML_TEMPLATE;

        if (gIsSinglePageMode) {
            txt = txt.replace("__SCRIPT_PATH__", "./" + pageKey + '/' + pageKey + ".jsx");
        } else {
            txt = txt.replace("__SCRIPT_PATH__", "./" + pageKey + ".jsx");
        }

        let htmlFilePath = jk_fs.join(p.genDir, pageKey + ".html");
        await jk_fs.writeTextToFile(htmlFilePath, txt);

        return scriptFilePath;
    }

    const installScript = getBrowserInstallScript();

    if (getWebSiteConfig().hasReactHmrFlag) {
        let globalCss = await getMergedGlobalCssFileContent();
        await jk_fs.writeTextToFile(jk_fs.join(p.genDir, "global-hmr.css"), globalCss);
    }

    if (p.singlePageMode) {
        let routeInfos = gPageKeyToRoute[p.pageKey!]
        let sourceFilePath = gPageKeyToSourceFile[p.pageKey!];
        await buildPage(sourceFilePath, routeInfos, p.pageKey!);
    } else {
        for (let sourceFilePath in gPageSourceFileToRoute) {
            const routeInfos = gPageSourceFileToRoute[sourceFilePath];
            const pageKey = "page_" + jk_crypto.fastHash(routeInfos.route);

            let outFilePath = await buildPage(sourceFilePath, routeInfos, pageKey);
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

const REACT_TEMPLATE_BASIC = `import React from "react";
import ReactDOM from "react-dom/client";
import {PageContext, PageController_ExposePrivate} from "jopijs/ui";
import C from "__PATH__";
import {JopiUiApplication, useParams} from "jopijs/ui";

import installer from "__INSTALL__";
__EXTRA_IMPORTS__

window["__JOPI_ROUTE__"] = __ROUTE__;
window["__JOPI_OPTIONS__"] = __OPTIONS__;

installer(new JopiUiApplication(undefined, __PAGE_EXTRA_PARAMS__));

function Render(p) {
    const [_, setCount] = React.useState(0);
    p.controller.onRequireRefresh = () => setCount(old => old + 1);
    return <C params={p.params} searchParams={p.searchParams} />;
}

function start() {
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
    
    const app = (
        <React.StrictMode>
            <PageContext.Provider value={controller}>
                <Render controller={controller} params={params} searchParams={searchParams} />
            </PageContext.Provider>
        </React.StrictMode>
    );
    
    const container = document.body;
    
    if (import.meta.hot) {
        const root = (import.meta.hot.data.root ??= ReactDOM.createRoot(container));
        root.render(app);
    } else {
        ReactDOM.createRoot(container).render(app);
    }
}

__SSE_EVENTS__

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
`;

// Use a transition to reduct flickering.
const REACT_TEMPLATE_TEST_FLICKERING = `import React from "react";
import ReactDOM from "react-dom/client";
import {PageContext, PageController_ExposePrivate} from "jopijs/ui";
import C from "__PATH__";
import {JopiUiApplication, useParams} from "jopijs/ui";

import installer from "__INSTALL__";
__EXTRA_IMPORTS__

window["__JOPI_ROUTE__"] = __ROUTE__;
window["__JOPI_OPTIONS__"] = __OPTIONS__;

installer(new JopiUiApplication(undefined, __PAGE_EXTRA_PARAMS__));

function Render(p) {
    const [_, setCount] = React.useState(0);
    p.controller.onRequireRefresh = () => setCount(old => old + 1);
    
    React.useLayoutEffect(() => {
        if (p.onMounted) p.onMounted();
    }, []);
    
    return <C params={p.params} searchParams={p.searchParams} />;
}

function start() {
    const params = useParams();
    const FADE_DURATION = 0.5; // Seconds

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

    const staticElements = Array.from(document.body.children);
    
    let container = document.getElementById("jopi-app-root");
    //
    if (!container) {
        container = document.createElement("div");
        container.id = "jopi-app-root";
        
        // Initial state for fade-in: Absolute overlay hidden
        container.style.opacity = "0";
        container.style.position = "absolute";
        container.style.top = "0";
        container.style.left = "0";
        container.style.width = "100%";
        container.style.zIndex = "2147483647";
        container.style.transition = "opacity " + FADE_DURATION + "s ease-in-out";
        
        document.body.appendChild(container);
    }

    const onMounted = () => {
        requestAnimationFrame(() => {
             container.style.opacity = "1";
        });

        setTimeout(() => {
            staticElements.forEach(el => {
                if (el.parentNode === document.body && el !== container) {
                    document.body.removeChild(el);
                }
            });
            
            container.style.position = "";
            container.style.top = "";
            container.style.left = "";
            container.style.width = "";
            container.style.zIndex = "";
            container.style.transition = "";
            container.style.opacity = "";
            
        }, FADE_DURATION * 1000);
    };

    const app = (
        <React.StrictMode>
            <PageContext.Provider value={controller}>
                <Render controller={controller} params={params} searchParams={searchParams} onMounted={onMounted} />
            </PageContext.Provider>
        </React.StrictMode>
    );
    
    if (import.meta.hot) {
        const root = (import.meta.hot.data.root ??= ReactDOM.createRoot(container));
        root.render(app);
    } else {
        ReactDOM.createRoot(container).render(app);
    }
}
__SSE_EVENTS__
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
`;

const REACT_TEMPLATE = REACT_TEMPLATE_BASIC;
//const REACT_TEMPLATE = REACT_TEMPLATE_TEST_FLICKERING;

/**
 * Allow knowing the route from the page file path.
 */
let gPageSourceFileToRoute: Record<string, RouteInfos> = {};

/**
 * Allow knowing the route from the page key.
 */
let gPageKeyToRoute: Record<string, RouteInfos> = {};

/**
 * Allow knowing the source file from the page key.
 */
let gPageKeyToSourceFile: Record<string, string> = {};

/**
 * Allow knowing the name of the .js and .css file for a page.
 */
const gRouteToPageKey: Record<string, string> = {};

const gIsSinglePageMode = getWebSiteConfig().isSinglePageMode;