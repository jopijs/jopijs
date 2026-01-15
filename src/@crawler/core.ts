/// <reference path="../@core/cheerio.d.ts" />

import {DirectFileCache} from "./directFileCache.ts";
import {UrlMapping} from "./urlMapping.ts";
import * as cheerio from 'cheerio';
import {getErrorMessage} from "jopi-toolkit/jk_tools";

// @ts-ignore no ts definition
import parseCssUrls from "css-url-parser";
import {applyDefaults, tick} from "./utils.ts";
import { logSsgCrawler } from "./_logs.ts";
import { isNodeJS } from "jopi-toolkit/jk_what";

import {
    type CrawlerCache, type CrawlerFetchResponse,
    type OnCrawlingFinishedInfos, ProcessUrlResult, UrlSortTools, type WebSiteCrawlerOptions
} from "./common.ts";
import { nodeFetch } from "./nodeFetch.ts";

interface UrlGroup {
    url: string;
    stack?: string[];
}

export class WebSiteCrawler {
    private readonly urlDone: string[] = [];

    private readonly newWebSite_basePath: string;
    private readonly newWebSite_lcBasePath: string;
    private readonly newWebSite_urlInfos: URL;

    private readonly requiredPrefix: string;
    private readonly requiredPrefix2: string;

    private isStarted = false;

    private readonly options: WebSiteCrawlerOptions;
    private readonly cache?: CrawlerCache;

    private currentGroup: UrlGroup = {url:"", stack:[]};
    private readonly groupStack: UrlGroup[] = [];

    private urlCount: number = 1;

    /**
     * Create a new crawler instance.
     *
     * @param sourceWebSite
     *      The url of the website to crawl.
     * @param options
     *      Options for complex cases.
     */
    constructor(sourceWebSite: string, options?: WebSiteCrawlerOptions) {
        options = applyDefaults(options, {
            requireRelocatableUrl: true,
        });

        options = this.options = {...options};

        let newWebSiteUrl = new URL(options.newWebSiteUrl || sourceWebSite).origin;
        this.newWebSite_basePath = newWebSiteUrl;
        this.newWebSite_lcBasePath = newWebSiteUrl.toLowerCase();

        const urlInfos = new URL(newWebSiteUrl);
        this.newWebSite_urlInfos = urlInfos;

        this.requiredPrefix = urlInfos.origin + "/";
        this.requiredPrefix2 = "//" + urlInfos.hostname;

        let sourceWebSiteOrigin = new URL(sourceWebSite).origin;

        if (sourceWebSiteOrigin!==newWebSiteUrl) {
            if (!options.rewriteThisUrls) options.rewriteThisUrls = [];

            // Allow rewriting the url.
            if (!options.rewriteThisUrls.includes(sourceWebSiteOrigin)) {
                options.rewriteThisUrls.push(sourceWebSiteOrigin);
            }
        }

        if (!options.urlMapping) {
            options.urlMapping = new UrlMapping(sourceWebSite);
        } else {
            if (!options.rewriteThisUrls) options.rewriteThisUrls = [];

            const knownOrigin = options.urlMapping.getKnownOrigins();

            knownOrigin.forEach(origin => {
                if (!options.rewriteThisUrls!.includes(origin)) {
                    options.rewriteThisUrls!.push(origin);
                }
            })
        }

        if (options.cache) {
            this.cache = options.cache;
        }
        else if (options.outputDir) {
            this.cache = new DirectFileCache(options.outputDir);
        }
    }

    /**
     * Start the processing
     */
    public async start(entryPoint?: string): Promise<OnCrawlingFinishedInfos> {
        if (!entryPoint) {
            entryPoint = this.newWebSite_basePath;
        }

        const newGroup = {url: entryPoint, stack: []};
        this.groupStack.push(newGroup);
        this.currentGroup = newGroup;

        if (this.options.scanThisUrls) {
            for (let i = 0; i < this.options.scanThisUrls.length; i++) {
                this.pushUrl(this.options.scanThisUrls[i]);
            }
        }

        await this.processStack();

        const finishedInfos: OnCrawlingFinishedInfos = {
            remainingStack: this.groupStack.map(g => g.url)
        };

        if (this.options.onFinished) {
            this.options.onFinished(finishedInfos);
        }

        return finishedInfos;
    }

    /**
     * Take an url and clean this url.
     * - Resolve relative url.
     * - Exclude special url ("mailto:", "tel:", ...)
     * - Exclude anchor url (starts with #).
     */
    private _cleanUpUrl(url: string | null): string | null {
        return this.cleanUpUrlAux(url, false);
    }

    /**
     * Is like cleanUpUrl but with a special case for CSS.
     *
     * Url in CSS is related to the dir of the CSS file.
     * If I have "myImage.jpg" then it's https//my/css/dir/myImage.jpg.
     */
    private cleanUpCssUrl(url: string, baseUrl: string): string | null {
        return this.cleanUpUrlAux(url, true, baseUrl);
    }

    private cleanUpUrlAux(url: string | null, isCss: boolean, currentUrl?: string): string | null {
        if (!url) return null;

        url = url.trim();
        if (!url) return null;

        if (url[0] === '#') return null;

        // Convert to an absolute url.
        if (!url.includes("://")) {
            if (url[0]==="?") {
                let currentUrl = this.currentGroup.url;
                let idx = currentUrl.indexOf("?");
                if (idx!==-1) currentUrl = currentUrl.substring(0, idx);
                url = currentUrl + url;
            }
            else if (url.includes(":")) {
                if (url.startsWith("data:")) return null;
                if (url.startsWith("javascript:")) return null;
                if (url.startsWith("mailto:")) return null;
                if (url.startsWith("tel:")) return null;
                if (url.startsWith("sms:")) return null;
                if (url.startsWith("ftp:")) return null;
            }

            if (url.startsWith("//")) {
                if (!url.toLowerCase().startsWith(this.requiredPrefix2)) return null;
                url = this.newWebSite_urlInfos.protocol + url;
            } else if (url[0] === "/") {
                url = resolveRelativeUrl(url, this.newWebSite_urlInfos);
            } else {
                if (isCss) {
                    url = resolveRelativeUrl(url, new URL(currentUrl!));
                } else {
                    url = resolveRelativeUrl(url, this.newWebSite_urlInfos);
                }
            }
        } else {
            url = this.rewriteSourceSiteUrl(url);
        }

        if (!url.toLowerCase().startsWith(this.requiredPrefix)) {
            return null;
        }

        return url.trim();
    }

    /**
     * Is called when we want to add an url to the processing queue.
     * A call to cleanUpUrl must have been done before.
     */
    private pushUrl(url: string | null): string {
        if (!url) return "";

        url = this._cleanUpUrl(url);
        if (!url) return "";

        if (this.urlDone.includes(url)) return url;
        this.urlDone.push(url);

        if (this.options.canDownload) {
            if (!this.options.canDownload(url.substring(this.requiredPrefix.length), this.isResource(url))) {
                return url;
            }
        }

        if (!this.currentGroup.stack) this.currentGroup.stack = [];
        this.currentGroup.stack.push(url);

        return url;
    }

    private async processStack(): Promise<void> {
        if (this.isStarted) return;
        this.isStarted = true;

        while (true) {
            const group = this.groupStack.shift();
            if (!group) break;

            if (!await this.processGroup(group)) break;
        }

        this.isStarted = false;
    }

    /**
     * Will fetch an url and process the result.
     * If the result is HTML, it will be analyzed.
     * Also, if it's CSS.
     */
    private async processGroup(group: UrlGroup): Promise<boolean> {
        logSsgCrawler.spam(`Processing group ${group.url}`);
        this.currentGroup = group;

        // Process the group main url.
        const processResponse = await this.processUrl(group.url);

        // Process the resource inside the group.
        if (group.stack) {
            logSsgCrawler.spam(`Processing group stack. ${group.stack.length} entries found`);

            let isResource: string[]|undefined;
            let isPage: string[]|undefined;

            group.stack.forEach(url => {
                if (this.isResource(url)) {
                    logSsgCrawler.spam(`Adding ${url} to resources`);
                    if (!isResource) isResource = [];
                    isResource.push(url);
                } else {
                    logSsgCrawler.spam(`Adding ${url} to pages`);
                    if (!isPage) isPage = [];
                    isPage.push(url);
                }
            });

            group.stack = undefined;

            // Stack the pages coming from the resources.
            if (isPage) {
                if ((isPage.length>1) && this.options.sortPagesToDownload) {
                    const sortTools = new UrlSortTools(isPage);
                    this.options.sortPagesToDownload(sortTools);
                    isPage = sortTools.result();
                }

                isPage.forEach(url => {
                    logSsgCrawler.spam(`Adding new group ${url}`);
                    this.groupStack.push({url});
                });
            }

            // Process the resources now.
            // Allow the page to be completely loaded.
            //
            while (isResource) {
                const resources = isResource;
                isResource = undefined;

                logSsgCrawler.spam(`Processing resources. ${resources.length} entries found`);

                for (let i = 0; i < resources.length; i++) {
                    const resUrl = resources[i];
                    logSsgCrawler.spam(`Processing resource ${resUrl}`);
                    const resState = await this.processUrl(resUrl);

                    if (this.options.onResourceDownloaded) {
                        this.options.onResourceDownloaded(resUrl, resState);
                    }
                }

                // Come from CSS.
                if (group.stack) {
                    isResource = group.stack;
                    group.stack = undefined;
                }
            }
        }

        if (this.options.onPageFullyDownloaded) {
            const res = this.options.onPageFullyDownloaded(group.url, processResponse);
            if (res instanceof Promise) await res;
            if (res===false) return false;
        }

        return true;
    }

    private isResource(u: string) {
        const url = new URL(u);
        u = url.pathname;

        let idx = u.lastIndexOf(".");
        if (idx===-1) return false;
        let ext = u.substring(idx);

        return gExtensionForResourceType.includes(ext);
    }

    private async processUrl(sourceUrl: string): Promise<ProcessUrlResult> {
        const sendSignal = (state: ProcessUrlResult) => {
            if (this.options.onUrlProcessed) {
                const date = Date.now();
                const elapsed = date - now;

                const cacheKey = this.cache?.getKey(transformedUrl);

                this.options.onUrlProcessed({
                    sourceUrl, requestedByUrl,
                    state, retryCount,
                    transformedUrl,
                    localUrl,
                    cacheKey,
                    urlCount: this.urlCount,
                    date, elapsed
                });
            }

            return state;
        }

        let retryCount = 0;
        const localUrl = sourceUrl.substring(this.newWebSite_basePath.length);

        const now = Date.now();
        const partialUrl = sourceUrl.substring(this.newWebSite_basePath.length);
        const requestedByUrl = this.currentGroup.url;

        const mappingResult = this.options.urlMapping!.resolveURL(partialUrl);
        if (!mappingResult) return ProcessUrlResult.IGNORED;

        let transformedUrl = sourceUrl;

        if (this.cache) {
            transformedUrl = this.transformFoundUrl(sourceUrl, false);
        }

        if (this.cache && this.options.canIgnoreIfAlreadyCrawled) {
            const isInCache = await this.cache.hasInCache(transformedUrl, requestedByUrl)

            if (isInCache && this.options.canIgnoreIfAlreadyCrawled(
                sourceUrl.substring(this.newWebSite_basePath.length), {sourceUrl: mappingResult.url})) {
                return sendSignal(ProcessUrlResult.IGNORED);
            }
        }

        if (mappingResult.wakeUpServer) {
            await mappingResult.wakeUpServer();
        }

        this.urlCount++;

        if (this.options.pauseDuration_ms) {
            await tick(this.options.pauseDuration_ms);
        }

        while (true) {
            try {
                let res: CrawlerFetchResponse;

                if (this.options.doFetch) {
                    res = await this.options.doFetch(this, mappingResult.url, requestedByUrl);
                }
                else {
                    logSsgCrawler.info(`Fetching url ${mappingResult.url}`);
                    let urlToFetch = mappingResult.url;
                                    
                    if (isNodeJS) {
                        if (urlToFetch.includes("//localhost")) {
                            urlToFetch = urlToFetch.replace("//localhost", "//127.0.0.1");
                        }
                        
                        res = await nodeFetch(urlToFetch, {
                            headers: {
                                "referer": requestedByUrl,
                                "Accept-Encoding": "identity"
                            },
                            
                            rejectUnauthorized: false
                        });
                    } else {
                        // noinspection JSUnusedGlobalSymbols
                        res = await fetch(urlToFetch, {
                            // > This option allows avoiding SSL certificate check.

                            // @ts-ignore
                            rejectUnauthorized: false,

                            requestCert: false,

                            tls: {
                                rejectUnauthorized: false,
                                checkServerIdentity: () => {
                                    return undefined
                                }
                            },

                            // Allow avoiding automatic redirections.
                            // @ts-ignore
                            redirect: 'manual',

                            headers: {
                                "referer": requestedByUrl,
                                "Accept-Encoding": "identity"
                            }

                            //verbose: true
                        }) as any;
                    }
                }

                logSsgCrawler.spam(`Status ${res.status} for url ${mappingResult.url}`);

                if (res.status !== 200) {
                    if (res.status >= 300 && res.status < 400) {
                        const location = res.headers.get("Location");
                        if (location) this.pushUrl(location);
                        return sendSignal(ProcessUrlResult.REDIRECTED);
                    } else {
                        let canContinue = false;

                        if (this.options.onInvalidResponseCodeFound) {
                            let what = this.options.onInvalidResponseCodeFound(sourceUrl, retryCount, res);
                            if (what instanceof Promise) what = await what;
                            canContinue = what;
                        } else if (retryCount < 3) {
                            // Retry 3 times, with a longer pause each time.
                            await tick(1000 * retryCount);
                            canContinue = true;
                        }

                        if (!canContinue) {
                            return sendSignal(ProcessUrlResult.ERROR);
                        }

                        retryCount++;

                        // Will retry automatically.
                        continue;
                    }
                }

                const contentType = res.headers.get("content-type");

                if (contentType) {
                    logSsgCrawler.spam(`Content-Type: ${contentType}`);
                    
                    if (contentType.startsWith("text/html")) {
                        let html = await res.text();

                        if (this.options.rewriteHtmlBeforeProcessing) {
                            let res = this.options.rewriteHtmlBeforeProcessing(html, sourceUrl.substring(this.newWebSite_basePath.length), mappingResult.url);
                            if (res instanceof Promise) res = await res;
                            html = res;
                        }

                        html = await this.processHtml(html);

                        if (this.options.rewriteHtmlBeforeStoring) {
                            let res = this.options.rewriteHtmlBeforeStoring(html, sourceUrl.substring(this.newWebSite_basePath.length), mappingResult.url);
                            if (res instanceof Promise) res = await res;
                            html = res;
                        }

                        res = new Response(html, {status: 200, headers: res.headers});
                    } else if (contentType.startsWith("text/css")) {
                        const content = await res.text();
                        const cssUrls = parseCssUrls(content) as string[];

                        if (cssUrls.length) {
                            cssUrls.forEach(u => {
                                const cleanedUrl = this.cleanUpCssUrl(u, sourceUrl);
                                if (cleanedUrl) this.pushUrl(cleanedUrl);
                            });
                        }

                        res = new Response(content, {status: 200, headers: res.headers});
                    }
                } else {
                    logSsgCrawler.spam(`No Content-Type found`);
                }

                if (this.cache) {
                    const buffer = await res.arrayBuffer();
                    let hRes = new Response(buffer, {status: res.status, headers: res.headers});
                    await this.cache.addToCache(transformedUrl, hRes, requestedByUrl);
                }

                return sendSignal(ProcessUrlResult.OK);
            }
            catch (e: any) {
                logSsgCrawler.error(`Crawler - Error while fetching: ${sourceUrl}`);
                logSsgCrawler.error(`|--> Message: ${getErrorMessage(e)}`);
                logSsgCrawler.error(e);

                return sendSignal(ProcessUrlResult.ERROR);
            }
        }
    }

    /**
     * Process an HTML file, which consiste:
     * - Extracting the url.
     * - Replacing this url inside the HTML to convert them.
     */
    private async processHtml(html: string): Promise<string> {
        // Extract all url and rewrite them inside the html.
        // Will emit calls to addUrl for each url found.

        const $ = cheerio.load(html);

        $("img, script, iframe, source").each((_i, node) => {
            let url = node.attribs["src"];

            if (url) {
                url = this.pushUrl(url);
                if (url.length) node.attribs["src"] = this.transformFoundUrl(url);
            }
        });

        $("a, link").each((_i, node) => {
            let url = node.attribs["href"];

            if (url) {
                url = this.pushUrl(url);
                if (url.length) {
                    node.attribs["href"] = this.transformFoundUrl(url);
                }
            }
        });

        $("img").each((_i, node) => {
            let srcset = node.attribs["srcset"];
            if (!srcset) return;

            const parts = srcset.split(",");
            let newSrcset = "";

            parts.forEach(p => {
                p = p.trim();
                const idx = p.indexOf(" ");
                if (idx === -1) return;

                let url = p.substring(0, idx);
                const size = p.substring(idx + 1);

                let newUrl = this.pushUrl(url);
                if (url.length) url = newUrl;

                url = this.transformFoundUrl(url);
                newSrcset += "," + url + " " + size;
            });

            node.attribs["srcset"] = newSrcset.substring(1);
        });

        html = $.html();

        // Security for residual urls.
        if (html.includes(this.newWebSite_basePath + "/"))
            html = html.replaceAll(this.newWebSite_basePath, "")
        if (html.includes(this.newWebSite_basePath))
            html = html.replaceAll(this.newWebSite_basePath, "/")

        return html;
    }

    /**
     * Allow rewriting the url from a source site (where we take our pages)
     *  to transform this url to a local url (our website).
     */
    rewriteSourceSiteUrl(url: string): string {
        if (this.options.rewriteThisUrls) {
            for (let i=0; i<this.options.rewriteThisUrls.length; i++) {
                const prefix = this.options.rewriteThisUrls[i];

                if (url.startsWith(prefix)) {
                    url = this.newWebSite_basePath + url.substring(prefix.length);
                    return url;
                }
            }
        }

        return url;
    }

    /**
     * Allow transforming an url found by the HTML parser.
     */
    transformFoundUrl(url: string, enableRelocatable: boolean = true) {
        if (this.options.transformUrl) {
            url = this.options.transformUrl(url, {
                crawler: this,
                comeFromPage: this.currentGroup.url!,
                requireRelocatableUrl: this.options.requireRelocatableUrl!
            });
        }

        if (enableRelocatable && this.options.requireRelocatableUrl) {
            url = this.urlTool_buildFileSystemUrl(url);
        }

        return url;
    }
    
    /**
     * Clean up the url to make it compatible with the file-system.
     * Will remove the query-string and the anchors part.
     * And make url relatif (with "../.." as a prefix).
     *
     * Why does relatif url are required?
     *      For example, I have a HTML page: file://folderA/webSiteRoot/myPage/index.html
     *          And now a css: /my/css/folder/style.css
     *      Here the final url will be:  file://folderA/webSiteRoot/myPage/my/css/folder/style.css
     *          and not:                 file://folderA/webSiteRoot/my/css/folder/style.css
     *      It's why                     my/css/folder/style.css
     *      must be transformed as    ../my/css/folder/style.css
     *      (only inside this page)
     */
    urlTool_buildFileSystemUrl(url: string): string {
        // Allow to not always check.
        if (!this.options.requireRelocatableUrl) return url;

        let idx = url.indexOf("?");
        if (idx !== -1) url = url.substring(0, idx);

        idx = url.indexOf("#");
        if (idx !== -1) url = url.substring(0, idx);

        // > If not a file, then it a directory.
        //   Transform it to be a /index.html file.

        if (url.endsWith("/")) {
            url += "index.html";
        } else {
            const lastSlash = url.lastIndexOf("/");
            const lastSegment = lastSlash === -1 ? url : url.substring(lastSlash + 1);

            if (!lastSegment.includes(".")) {
                url += "/index.html";
            }
        }

        // Make the url relatif.
        //
        if (url.startsWith(this.newWebSite_lcBasePath)) {
            url = url.substring(this.newWebSite_lcBasePath.length + 1);

            let currentUrl = this.currentGroup.url.substring(this.newWebSite_lcBasePath.length + 1);
            if (!currentUrl) return url;
            if (url === currentUrl) return url;

            let backCount = currentUrl.split("/").length;
            if (currentUrl.endsWith("/")) backCount--;

            for (let i = 0; i < backCount; i++) url = "../" + url;
        }

        return url;
    }
}

function resolveRelativeUrl(url: string, baseUrl: URL): string {
    if (url[0]==="/") {
        if (url[1]==="/") {
            const urlInfos = new URL(url);
            urlInfos.protocol = baseUrl.protocol;
            urlInfos.port = baseUrl.port;
            return urlInfos.toString();
        } else {
            return baseUrl.toString() + url.substring(1);
        }
    } else if (url[0]===".") {
        return new URL(url, baseUrl).toString();
    }

    return url;
}

const gExtensionForResourceType = [
    ".css", ".js", ".jpg", ".png", ".jpeg", ".gif", ".svg", ".webp",
    ".woff", ".woff2", ".ttf", ".txt", ".avif", ".ico"
];