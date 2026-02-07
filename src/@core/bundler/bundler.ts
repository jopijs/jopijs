import {CoreWebSite} from "../jopiCoreWebSite.ts";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_events from "jopi-toolkit/jk_events";
import {getBundleDirPath} from "./config.ts";
import {type BundlerConfig, getBundlerConfig} from "./config.ts";
import {getExtraCssToBundle} from "./extraContent.ts";
import {configureServer} from "./server.ts";
import {getVirtualUrlMap, type VirtualUrlEntry} from "jopijs/loader-tools";
import {getWebSiteConfig} from "jopijs/coreconfig";
import {logBundler} from "../_logs.ts";

export interface CreateBundleParams {
    innerUrl: string;

    entryPoints: string[];
    outputDir: string;
    genDir: string;
    publicUrl: string;
    webSite: CoreWebSite;
    config: BundlerConfig,
    requireTailwind: boolean;
    virtualUrlMap: VirtualUrlEntry[];

    pageRoute?: string;
    pageKey?: string;
    pageScript?: string;
    pageExtraParams: any;

    promise?: Promise<void>;
}

export async function createBundle(webSite: CoreWebSite): Promise<void> {
    const genDir = getBundleDirPath();
    const outputDir = jk_fs.join(genDir, "out");

    // Reset the dir.
    await jk_fs.rmDir(genDir);
    await jk_fs.mkDir(genDir);

    const innerUrl =  "/_bundle/";
    const publicUrl = webSite.welcomeUrl + innerUrl;

    // noinspection PointlessBooleanExpressionJS
    const requireTailwind: boolean = (getBundlerConfig().tailwind.disable) !== true;

    const cssToImport = [...getExtraCssToBundle()];

    if (requireTailwind) cssToImport.push("./global.css");

    // Bun has his own bundler system of development.
    const config = getBundlerConfig();

    gCreateBundleData = {
        outputDir, genDir, publicUrl, innerUrl, webSite, requireTailwind,
        config: getBundlerConfig(), entryPoints: [...config.entryPoints],
        virtualUrlMap: getVirtualUrlMap(),
        pageExtraParams: webSite.getExtraPageParams()
    };

    await executeBundler(gCreateBundleData);

    configureServer(outputDir);
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

    const endLog = logBundler.beginInfo("Bundling all pages");

    // Will create the HTML pages.
    await jk_events.sendAsyncEvent("@jopi.bundler.beforeCreateBundle", params);
    await jk_events.sendAsyncEvent("@jopi.bundler.createBundle", params);

    endLog();
}

const FALLBACK_PACKAGE = "jopijs/bundler";
let gIsBundlerLoader = false;
let gCreateBundleData: CreateBundleParams|undefined;
