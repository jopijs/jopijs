import {CoreWebSiteImpl} from "../jopiCoreWebSite.tsx";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_events from "jopi-toolkit/jk_events";
import {getBundleDirPath} from "./config.ts";
import {type BundlerConfig, getBundlerConfig} from "./config.ts";
import {getExtraCssToBundle} from "./extraContent.ts";
import {configureServer} from "./server.ts";
import {getVirtualUrlMap, type VirtualUrlEntry} from "jopijs/loader-tools";
import {isSinglePageMode} from "jopijs/loader-client";
import {logBundler} from "../_logs.ts";

export interface CreateBundleParams {
    // Is enabled when JOPI_DEV or JOPI_DEV_UI
    // If bun.js: bundler is never called when JOPI_DEV_UI.
    //            since it uses React HMR mode.
    //
    singlePageMode: boolean;

    innerUrl: string;

    entryPoints: string[];
    outputDir: string;
    genDir: string;
    publicUrl: string;
    webSite: CoreWebSiteImpl;
    config: BundlerConfig,
    requireTailwind: boolean;
    virtualUrlMap: VirtualUrlEntry[];

    pageRoute?: string;
    pageKey?: string;
    pageScript?: string;
    pageExtraParams: any;

    promise?: Promise<void>;
}

export async function createBundle(webSite: CoreWebSiteImpl): Promise<void> {
    const genDir = getBundleDirPath(webSite);
    const outputDir = jk_fs.join(genDir, "out");

    // Reset the dir.
    await jk_fs.rmDir(genDir);
    await jk_fs.mkDir(genDir);

    const innerUrl =  "/_bundle/";
    const publicUrl = webSite.welcomeUrl + innerUrl;

    // noinspection PointlessBooleanExpressionJS
    const requireTailwind: boolean = (getBundlerConfig().tailwind.disable) !== true;

    const cssToImport = [...getExtraCssToBundle()];

    if (requireTailwind) cssToImport.push("./tailwind.css");

    // Bun has his own bundler system of development.
    const config = getBundlerConfig();

    gCreateBundleData = {
        singlePageMode: isSinglePageMode(),
        outputDir, genDir, publicUrl, innerUrl, webSite, requireTailwind,
        config: getBundlerConfig(), entryPoints: [...config.entryPoints],
        virtualUrlMap: getVirtualUrlMap(),
        pageExtraParams: webSite.getExtraPageParams()
    };

    await executeBundler(gCreateBundleData);

    configureServer(outputDir);
}

let gCreateBundleData: CreateBundleParams|undefined;

let gPageBundlerIsOk: Record<string, boolean> = {};

export async function createBundleForPage(pageKey: string, route: string) {
    // Allow knowing of this page is already compiled.
    if (gPageBundlerIsOk[pageKey]) return;
    gPageBundlerIsOk[pageKey] = true;

    const endLog = logBundler.beginInfo((w) => w("Bundling page for route " + route));

    let fileName = pageKey + ".jsx";

    if (!gCreateBundleData) return;

    let params = {...gCreateBundleData};
    params.pageRoute = route;
    params.pageKey = pageKey;
    params.pageScript = jk_fs.join(params.genDir, fileName);

    await jk_events.sendAsyncEvent("@jopi.bundler.beforeCreateBundleForPage", params);
    await jk_events.sendAsyncEvent("@jopi.bundler.createBundleForPage", params);

    endLog();
}

async function executeBundler(params: CreateBundleParams) {
    if (!gIsBundlerLoader) {
        gIsBundlerLoader = true;
        await import(FALLBACK_PACKAGE);
    }

    // createBundle is called when the event is triggered.
    //
    // Here we will compile all the pages in one go.
    // It's why it's not enabled with single-page mode.
    //
    // When using React HMR, we don't use the same bundler.
    // (internally it's an optimized single-page mode).
    // So, we don't need to compile the full bundle.

    if (!isSinglePageMode()) {
        const endLog = logBundler.beginInfo("Bundling all pages");

        // Will create the HTML pages.
        await jk_events.sendAsyncEvent("@jopi.bundler.beforeCreateBundle", params);
        await jk_events.sendAsyncEvent("@jopi.bundler.createBundle", params);

        endLog();
    }
}
//
const FALLBACK_PACKAGE = "jopijs/bundler";
let gIsBundlerLoader = false;