import {UrlMapping} from "./urlMapping.ts";
import type {WebSiteCrawler} from "./core.ts";

export interface CrawlerCache {
    hasInCache(url: string, requestedByUrl: string): Promise<boolean>;
    addToCache(url: string, response: Response, requestedByUrl: string): Promise<void>;
    getKey(url: string): string;
}

export interface CrawlerTransformUrlInfos {
    /**
     * The local url of the page from which this url has been found.
     */
    comeFromPage: string;

    /**
     * The instance of the crawler.
     */
    crawler: WebSiteCrawler;

    /**
     * If true, this mean we need a final url which is ok with
     * opening the page directly from the file-system.
     */
    requireRelocatableUrl: boolean;
}

export interface CrawlerCanIgnoreIfAlreadyCrawled {
    /**
     * The url which will be fetched.
     */
    sourceUrl: string;
}

export interface WebSiteCrawlerOptions {
    /**
     * If set, then will save the page inside this directory.
     * Warning: will replace the cache value.
     */
    outputDir?: string;

    /**
     * Allow using a cache to save the HTML pages and resource
     * and get theses that are already in the cache.
     */
    cache?: CrawlerCache;

    /**
     * If defined, then allow rewriting an url found by the HTML analyzer.
     *
     * @param url
     *      The url found, converted to local site url.
     * @param infos
     *      Information about the context.
     */
    transformUrl?(url: string, infos: CrawlerTransformUrlInfos): string;

    /**
     * Is called when an URL is found and the content is HTML.
     * Allow altering the HTML which will be processed or post-process URL.
     */
    rewriteHtmlBeforeProcessing?: (html: string, url: string, sourceUrl: string) => string|Promise<string>;

    /**
     * Is called when an URL is found and the content is HTML.
     * Allow altering the final HTML.
     * Is called after URL extraction.
     */
    rewriteHtmlBeforeStoring?: (html: string, url: string, sourceUrl: string) => string|Promise<string>;

    /**
     * Allow ignoring an entry if already crawled.
     * The function takes and url (without a base path) and
     * returns true if the page can be ignored, or false if it must crawl.
     */
    canIgnoreIfAlreadyCrawled?: (url: string, infos: CrawlerCanIgnoreIfAlreadyCrawled) => boolean;

    /**
     * Alter the final HTML to make the URL relocatable.
     * This means we can copy and paste the website without attachement to the website name.
     * Default is true.
     */
    requireRelocatableUrl?: boolean;

    /**
     * A list of url which must be replaced.
     * If one of these urls is found as an url prefix,
     * then replace it by the baseUrl.
     */
    rewriteThisUrls?: string[];

    /**
     * A list of urls to scan.
     * Allow including forgotten urls (which mainly come from CSS or JavaScript).
     * Ex: ["/my-style.css"].
     */
    scanThisUrls?: string[];

    /**
     * A mapper that allows knowing where to get data.
     * Allow things like:
     *      "/documentation/docA" --> "https://my-docsite.local/documentaiton/docA".
     *      "/blog/my-blog-entry" --> "https://my-blog.local/my-blog-entry".
     */
    urlMapping?: UrlMapping;

    /**
     * The url of the new website, if downloading.
     */
    newWebSiteUrl?: string;

    /**
     * Allow the crawler to do a pause between two call to the server.
     * The default value is 0: no pause.
     */
    pauseDuration_ms?: number;

    /**
     * Is called once a page is entirely downloaded.
     * This means the page himself and all the links starting from this page.
     * Will allow stopping the downloading by returning false.
     */
    onPageFullyDownloaded?: (url: string, state: ProcessUrlResult) => void|undefined|boolean|Promise<boolean>;

    /**
     * Is called when a resource is downloaded (.js, .css, .png, ...)
     */
    onResourceDownloaded?(url: string, state: ProcessUrlResult): void;

    /**
     * Allow sorting (and filtering) the pages we must download.
     * The main use case is to prioritize some pages when there is a large breadcrumb/pager/menu.
     */
    sortPagesToDownload?(allUrls: UrlSortTools): void;

    /**
     * Is called when a resource returns a code which isn't 200 (ok) or a redirect.
     * Return true if retry to download, false to stop.
     */
    onInvalidResponseCodeFound?: (url: string, retryCount: number, response: CrawlerFetchResponse) => boolean|Promise<boolean>;

    /**
     * Is called to know if this url can be downloaded.
     *
     * @param url
     *      The local url of the page (ex: /my-page).
     * @param isResource
     *      true is the url is pointing to a resource (.css,.png,...)
     *      false otherwise.
     */
    canDownload?(url: string, isResource: boolean): boolean;

    /**
     * Is called when a URL is processed.
     * Allow building stats or listing all urls found.
     */
    onUrlProcessed?(infos: UrlProcessedInfos): void;

    /**
     * Is called when the crawling is finished.
     * @param infos
     */
    onFinished?(infos: OnCrawlingFinishedInfos): void;

    /**
     * Allow replacing the fetch function with our own fetch.
     */
    doFetch?: CrawlerFetch;
}

export type CrawlerFetch = (crawler: WebSiteCrawler, url: string, referer: string) => Promise<CrawlerFetchResponse>;

export interface CrawlerFetchResponse {
    status: number;
    headers: Headers;
    body: ReadableStream<Uint8Array> | null;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
}

export interface OnCrawlingFinishedInfos {
    remainingStack: string[]
}

export interface UrlProcessedInfos {
    sourceUrl: string;
    urlCount: number;
    localUrl: string;
    transformedUrl: string;
    requestedByUrl: string;
    state: ProcessUrlResult;
    retryCount: number;

    date: number;
    elapsed: number;

    /**
     * The path inside the cache.
     */
    cacheKey?: string;
}

export enum ProcessUrlResult {
    /**
     * The resource has been downloaded.
     */
    OK = "ok",

    /**
     * The resource was a redirection.
     */
    REDIRECTED = "redirected",

    /**
     * An error occurred while processing the resource
     * or the resources is an error page.
     */
    ERROR = "error",

    /**
     * The resource has been ignored.
     * Probably because it was already downloaded.
     */
    IGNORED = "ignored"
}

export class UrlSortTools {
    constructor(allUrls: string[]) {
        this.allUrl = allUrls;
    }

    /**
     * Remove the urls for which the filter response true
     * and return an array with the extracted urls.
     */
    remove(filter: (url: string) => boolean): UrlSortTools {
        const removed: string[] = [];
        const others: string[] = [];

        this.allUrl.forEach(url => {
            if (filter(url)) removed.push(url);
            else others.push(url);
        });

        this.removed = removed;
        this.allUrl = others;

        return this;
    }

    sortAsc(): UrlSortTools {
        this.allUrl = this.allUrl.sort();
        return this;
    }

    addRemovedBefore(): UrlSortTools {
        if (!this.removed) return this;
        this.allUrl = [...this.removed, ...this.allUrl];
        this.removed = undefined;
        return this;
    }

    addRemovedAfter(): UrlSortTools {
        if (!this.removed) return this;
        this.allUrl = [...this.allUrl, ...this.removed];
        this.removed = undefined;
        return this;
    }

    result(): string[] {
        return this.allUrl;
    }

    removed?: string[];
    allUrl: string[];
}
