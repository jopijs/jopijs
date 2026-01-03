import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_process from "jopi-toolkit/jk_process";
import path from "node:path";
import {isBunJS} from "jopi-toolkit/jk_what";

export interface WebSiteConfig {
    /**
     * When importing a file, if this option is set, then
     * we will not return a file path on the filesystem
     * but an url pointing to this resource.
     *
     * The value here must be the PUBLIC url.
     */
    webSiteUrl: string;

    /**
     * It's the url on which the website listens to if we don't use
     * explicite url when defining the website.
     *
     * Here it's the PRIVATE url.
     *
     * If not defined, take the value of webSiteUrl.
     */
    webSiteListeningUrl: string;

    /**
     * Is similar to 'webResourcesRoot' but for the server side resources.
     * The server will redirect the resources from this url to the final
     * url resolved once bundled.
     */
    webResourcesRoot_SSR: string;

    /**
     * Is used with `webSiteUrl` to known where
     * whe cas found the resource. Will allow installing
     * a file server.
     */
    webResourcesRoot: string;

    /**
     * File which size is over this limite
     * will not be inlined when option ?inline
     * is set in the 'import', but resolved as
     * a file path (or ulr).
     */
    inlineMaxSize_ko: number;

    /**
     * Indicate the directory where the bundler
     * stores the images and resources.
     * (use linux path format)
     */
    bundlerOutputDir: string;

    /**
     * Indicate if is in production mode.
     */
    isProduction: boolean;

    isBrowserRefreshEnabled: boolean;
    hasJopiDevFlag: boolean;
    hasJopiDevUiFlag: boolean;
    isSinglePageMode: boolean;
    isReactHMR: boolean;
}

export function getWebSiteConfig(): WebSiteConfig {
    if (gWebSiteConfig) return gWebSiteConfig;
    gWebSiteConfig = calcWebSiteConfig();
    return gWebSiteConfig!;
}

export function getCodeGenSourceDir() {
    if (!gCodeGenSourceDir) {
        gCodeGenSourceDir = jk_fs.join(process.cwd(), "src", ".jopi-codegen");
    }

    return gCodeGenSourceDir;
}

function calcWebSiteConfig(): WebSiteConfig {
    function urlToPath(url: string) {
        let urlInfos = new URL(url);
        let port = urlInfos.port;

        if (port.length && port[0]!==':') port = ':' + port;
        return (urlInfos.hostname + port).replaceAll(".", "_").replaceAll(":", "_");
    }

    let pkgJsonFilePath = jk_app.findPackageJson();

    const hasJopiDevFlag = process.env.JOPI_DEV === "1";
    const hasJopiDevUiFlag = process.env.JOPI_DEV_UI === "1";
    const isBrowserRefreshEnabled = hasJopiDevFlag || hasJopiDevUiFlag;
    /**
     * React HMR is when the browser automatically refreshes his content
     * but without a full refresh. It does a clever refresh by removing old
     * JavaScript and injecting the new-one, before re-rendering the React components
     * without losing their previous state.
     */
    const isReactHMR = hasJopiDevUiFlag && isBunJS;

    /**
     * Single page mode is when the internal bundle compiles the pages one by one.
     * It's used for development to have a fast starting time.
     *
     * The opposite (when not single-page mode) is to compile all the pages in one go.
     * This produces an optimized bundle, without duplicates, but can be slow to start.
     */
    let isSinglePageMode: boolean;

    // Bun.js has his own bundler.
    if (isReactHMR) isSinglePageMode = false;
    else isSinglePageMode = hasJopiDevFlag || hasJopiDevUiFlag;

    let bundlerOutputDir = jopiTempDir;

    let conf_webResourcesRoot = "_bundle";
    let conf_inlineMaxSize_ko = INLINE_MAX_SIZE_KO;

    let conf_bundlerOutputDir: string|undefined;
    let conf_webSiteUrl: string|undefined;
    let conf_webSiteListeningUrl: string|undefined;
    let conf_webResourcesRoot_SSR: string|undefined;

    if (pkgJsonFilePath) {
        try {
            let json = jk_fs.readJsonFromFileSync(pkgJsonFilePath);
            let jopi = json.jopi;

            if (jopi) {
                let webSiteUrl = jopi.webSiteUrl;
                if (webSiteUrl && !webSiteUrl.endsWith("/")) webSiteUrl += '/';
                //
                conf_webSiteUrl = webSiteUrl;

                let webSiteListeningUrl = jopi.webSiteListeningUrl;
                if (webSiteListeningUrl && !webSiteListeningUrl.endsWith("/")) webSiteListeningUrl += '/';
                //
                conf_webSiteListeningUrl = webSiteListeningUrl;

                let webResourcesRoot = jopi.webResourcesRoot || "_bundle";
                if (webResourcesRoot[0]==='/') webResourcesRoot = webResourcesRoot.substring(1);
                if (!webResourcesRoot.endsWith("/")) webResourcesRoot += "/";
                //
                conf_webResourcesRoot = webResourcesRoot;
                conf_webResourcesRoot_SSR = webResourcesRoot.slice(0, -1) + "_s/";

                if (typeof(jopi.inlineMaxSize_ko)=="number") {
                    conf_inlineMaxSize_ko = jopi.inlineMaxSize_ko || INLINE_MAX_SIZE_KO;
                }

                if (webResourcesRoot.bundlerOutputDir) {
                    bundlerOutputDir = webResourcesRoot.bundlerOutputDir;
                }
            }
        } catch {
        }
    }

    if (process.env.JOPI_WEBSITE_URL) {
        conf_webSiteUrl = process.env.JOPI_WEBSITE_URL;
    }

    if (process.env.JOPI_WEBSITE_LISTENING_URL) {
        conf_webSiteListeningUrl = process.env.JOPI_WEBSITE_LISTENING_URL;
    }

    if (!conf_webSiteListeningUrl) {
        conf_webSiteListeningUrl = conf_webSiteUrl;
    } else if (!conf_webSiteUrl) {
        conf_webSiteUrl = conf_webSiteListeningUrl;
    }

    if (bundlerOutputDir && conf_webSiteUrl) {
        if (path.sep !== "/") {
            bundlerOutputDir = bundlerOutputDir.replaceAll("/", path.sep);
        }

        bundlerOutputDir = path.resolve(bundlerOutputDir);
        bundlerOutputDir = path.join(bundlerOutputDir, urlToPath(conf_webSiteUrl));
        conf_bundlerOutputDir = bundlerOutputDir;
    }

    return {
        webResourcesRoot: conf_webResourcesRoot,
        inlineMaxSize_ko: conf_inlineMaxSize_ko,
        bundlerOutputDir: conf_bundlerOutputDir!,
        webSiteUrl: conf_webSiteUrl!,
        webSiteListeningUrl: conf_webSiteListeningUrl!,
        webResourcesRoot_SSR: conf_webResourcesRoot_SSR!,

        isProduction: jk_process.isProduction,

        isBrowserRefreshEnabled,
        hasJopiDevFlag,
        hasJopiDevUiFlag,
        isSinglePageMode,
        isReactHMR
    }
}

export const jopiTempDir = jk_fs.join(process.cwd(), ".jopijs");
jk_app.setTempDir(jopiTempDir);

const INLINE_MAX_SIZE_KO = 3;
let gWebSiteConfig: WebSiteConfig|undefined;
let gCodeGenSourceDir: string|undefined;