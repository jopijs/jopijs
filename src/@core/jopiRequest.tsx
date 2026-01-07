// noinspection JSUnusedGlobalSymbols

import type { CoreServer, ServerSocketAddress } from "./jopiServer.ts";
import { ServerFetch } from "./serverFetch.ts";
import React, { type ReactNode } from "react";
import {PageController_ExposePrivate, type PageOptions} from "jopijs/ui";
import * as ReactServer from "react-dom/server";
import * as cheerio from "cheerio";
import type { SearchParamFilterFunction } from "./searchParamFilter.ts";
import * as jk_schema from "jopi-toolkit/jk_schema";
import * as jk_what from "jopi-toolkit/jk_what";
import * as jk_fs from "jopi-toolkit/jk_fs";
import Page from "./PageComponent.tsx";

import { initCheerio } from "./jQuery.ts";
import { type CacheEntry, type PageCache } from "./caches/cache.ts";
import {
    type AuthResult,
    type CookieOptions, SBPE_DirectSendThisResponseException,
    type HttpMethod, type JopiRouteHandler, type LoginPassword, SBPE_NotAuthorizedException,
    type RequestBody,
    type ResponseModifier, type ServeFileOptions, type TestCookieValue, type TextModifier, type UserInfos,
    CoreWebSite,
    type WebSiteRouteInfos, SBPE_ServerByPassException
} from "./jopiCoreWebSite.tsx";

import { parseCookies } from "./internalTools.ts";
import * as jk_term from "jopi-toolkit/jk_term";
import {getWebSiteConfig} from "jopijs/coreconfig";
import { isNodeJS } from "jopi-toolkit/jk_what";
import { createBundleForPage } from "./bundler/index.ts";
import { type BrowserCacheValidationInfos, type ReqReturnFileParams } from "./browserCacheControl.ts";
import { WebSiteMirrorCache } from "./caches/webSiteMirrorCache.ts";
import type { PageDataProviderData } from "jopijs/ui";

/**
 * Represents an incoming HTTP request in the JopiJS framework.
 * 
 * JopiRequest is the central object passed to API handlers (onGET, onPOST, etc.) and page components.
 * It encapsulates the standard Fetch API Request and provides a rich set of higher-level tools for:
 * 
 * - **Data Extraction**: Easily retrieve JSON, Form Data, URL parameters, and route parts.
 * - **Response Generation**: Helper methods to return HTML, JSON, redirects, and standard errors.
 * - **Security & Auth**: Manage JWT tokens, authenticate users, and enforce role-based access control (RBAC).
 * - **Cache Control**: Manually interact with the JopiJS cache engine or force cache bypass.
 * - **Proxying**: Forward requests to backend servers or fetch internal resources via the load-balancer.
 * - **File Serving**: Efficiently serve static files with automatic browser cache validation (ETags).
 * - **React Integration**: Methods for server-side rendering of React components.
 * 
 * It acts as an abstraction layer over the raw request, making common web development tasks 
 * more intuitive and consistent across different environments (Bun, Node.js).
 */
export class JopiRequest {
    /**
     * The cache used for the current request.
     */
    private cache: PageCache;

    private readonly mainCache: PageCache;

    private _req_headers: Headers;
    private _req_urlParts?: Record<string, string | string[]>;
    private _req_urlParts_done: boolean;

    constructor(protected readonly webSite: CoreWebSite,
        private _urlInfos: URL | undefined,
        public coreRequest: Request,
        protected readonly coreServer: CoreServer,
        public readonly routeInfos: WebSiteRouteInfos,
        req_urlParts: Record<string, string | string[]> | undefined,
    ) {
        this.cache = webSite.mainCache;
        this.mainCache = this.cache;
        this._req_headers = this.coreRequest.headers;

        this._req_urlParts = req_urlParts;
        this._req_urlParts_done = false;
    }

    //region Custom data

    /**
     * A key-value store for custom data associated with the request.
     * Useful for passing data between middleware or plugins during the request lifecycle.
     */
    get customData(): any {
        if (!this._customData) this._customData = {};
        return this._customData;
    }

    /**
     * Sets a custom value for a specific key in the request context.
     * @param key The key to store the value under.
     * @param value The value to store.
     */
    setCustomData(key: string, value: any) {
        if (!this._customData) this._customData = {};
        this._customData[key] = value;
    }

    /**
     * Retrieves a custom value by its key.
     * @param key The key of the value to retrieve.
     * @returns The value if found, or undefined.
     */
    getCustomData<T = any>(key: string): T | undefined {
        return this.customData[key];
    }

    //endregion

    //region Request

    //region Properties

    private _customData?: any;

    /**
     * The parsed URL information for the current request.
     * Contains properties like pathname, searchParams, hash, etc.
     */
    get req_urlInfos(): URL {
        if (!this._urlInfos) {
            this._urlInfos = new URL(this.coreRequest.url);
            this._urlInfos.hash = "";
        }

        return this._urlInfos;
    }

    /**
     * Return the HTTP verb used for the request (GET, POST, PUT, DELETE, ...).
     */
    get req_method(): HttpMethod {
        return this.coreRequest.method as HttpMethod;
    }

    /**
     * Return the Content-Type header of the request.
     * @returns The content type string or null if not present.
     */
    get req_contentType(): string | null {
        return this.coreRequest.headers.get("content-type");
    }

    /**
     * The full URL of the request as a string.
     */
    get req_url(): string {
        return this.coreRequest.url;
    }

    /**
     * The raw body of the request.
     * Note: Depending on the environment, this might be a ReadableStream or null.
     */
    get req_body(): RequestBody {
        return this.coreRequest.body;
    }

    /**
     * The headers of the incoming request.
     */
    get req_headers(): Headers {
        return this._req_headers;
    }

    set req_headers(value: Headers) {
        this._req_headers = value;
    }

    /**
     * The dynamic parts of the URL path derived from the route definition.
     * Example:
     * - Route: `/products/[category]/[id]`
     * - URL: `/products/electronics/123`
     * - Result: `{ category: "electronics", id: "123" }`
     */
    get req_urlParts(): Record<string, string | string[]> {
        if (this._req_urlParts_done) {
            return this._req_urlParts!;
        }

        const routeInfos = this.routeInfos;
        let urlParts = this._req_urlParts || {};

        if (routeInfos.catchAllSlug) {
            /*let routeExtractFromIdx = routeInfos.route.split("/").length - 1;
            let pathname = this.req_urlInfos.pathname.split("/");

            let value = "";

            for (let i = routeExtractFromIdx; i < pathname.length; i++) {
                value += "/" + pathname[i];
            }

            urlParts[routeInfos.catchAllSlug] = value;*/

            urlParts[routeInfos.catchAllSlug] = (urlParts["_"] as string).split("/");
        }

        this._req_urlParts_done = true;
        this._req_urlParts = urlParts;

        return urlParts;
    }

    /**
     * Returns the URL search parameters as a plain object.
     * Example:
     * - URL: `https://site.com/?sort=asc&filter=new`
     * - Result: `{ sort: "asc", filter: "new" }`
     */
    get req_urlSearchParams(): any {
        const sp = this.req_urlInfos.searchParams;
        if (!sp.size) return {};

        const res: any = {};
        sp.forEach((value, key) => res[key] = value);
        return res;
    }

    /**
     * Returns information about the caller's IP address.
     * @returns An object containing the IP address and family, or null if undetermined.
     */
    get req_callerIP(): ServerSocketAddress | null {
        return this.coreServer.requestIP(this.coreRequest);
    }

    /**
     * Checks if the request originated from localhost (127.0.0.1 or ::1).
     */
    get req_isFromLocalhost() {
        const ip = this.req_callerIP;
        if (!ip) return false;

        const address = ip.address;

        switch (address) {
            case "::1":
            case "127.0.0.1":
            case "::ffff:127.0.0.1":
                return true;
        }

        return false;
    }

    //endregion

    /**
     * Remove the hash (#this-part) and search params (?a=this-part) from the url.
     */
    req_clearSearchParamsAndHash() {
        this.req_urlInfos.search = "";
        this.req_urlInfos.hash = "";
    }

    //endregion

    //region Body transforming

    /**
     * Aggregates and returns data from all available sources in the request.
     * Sources include:
     * - URL path parameters (`req_urlParts`)
     * - URL search parameters (Query String)
     * - Request Body (JSON, Form Data, or URL Encoded)
     * 
     * @param options Configuration options.
     * @param options.ignoreUrl If true, ignores URL parameters and only returns body data.
     * @param options.dataSchema Optional schema to validate the returned data against.
     * @returns A promise resolving to the aggregated data object.
     */
    async req_getData<T = any>(options?: { ignoreUrl?: boolean, dataSchema?: jk_schema.Schema }): Promise<T> {
        let res: any = {};

        if (!(options && options.ignoreUrl)) {
            const searchParams = this.req_urlInfos.searchParams;

            if (searchParams.size) {
                searchParams.forEach((value, key) => res[key] = value);
            }

            if (this.req_urlParts) {
                res = { ...res, ...this.req_urlParts };
            }
        }

        if (this.req_isBodyJson) {
            try {
                const asJson = await this.req_bodyAsJson();
                if (asJson) res = { ...res, ...asJson };
            } catch {
                // If JSON is invalid.
            }
        } else if (this.req_isBodyXFormUrlEncoded) {
            try {
                let data = await this.req_bodyAsText();
                new URLSearchParams(data).forEach((value, key) => res[key] = value);
            } catch {
                // If invalid.
            }
        } else if (this.req_isBodyFormData) {
            try {
                const asFormData = await this.req_bodyAsFormData();
                asFormData.forEach((value, key) => res[key] = value);
            } catch {
                // If FormData is invalid.
            }
        }

        if (options && options.dataSchema) {
            this.tool_validateDataSchema(res, options.dataSchema);
        }

        return res as T;
    }

    /**
     * Parses and returns the request body data.
     * Automatically handles JSON, URL-Encoded, and Multipart Form Data.
     * 
     * @param options Configuration options.
     * @param options.dataSchema Optional schema to validate the body data against.
     * @returns A promise resolving to the parsed body data.
     */
    async req_getBodyData<T = any>(options?: { dataSchema?: jk_schema.Schema }): Promise<T> {
        let res: any = {};

        if (this.req_isBodyJson) {
            try {
                const asJson = await this.req_bodyAsJson();
                if (asJson) res = { ...res, ...asJson };
            } catch {
                // If JSON is invalid.
            }
        } else if (this.req_isBodyXFormUrlEncoded) {
            try {
                let data = await this.req_bodyAsText();
                new URLSearchParams(data).forEach((value, key) => res[key] = value);
            } catch {
                // If invalid.
            }
        } else if (this.req_isBodyFormData) {
            try {
                const asFormData = await this.req_bodyAsFormData();
                asFormData.forEach((value, key) => res[key] = value);
            } catch {
                // If FormData is invalid.
            }
        }

        if (options && options.dataSchema) {
            this.tool_validateDataSchema(res, options.dataSchema);
        }

        return res as T;
    }

    /**
     * Returns all the data about the request, organized by category.
     */
    async req_getDataInfos<T = any>(): Promise<T> {
        let res: any = {};

        const searchParams = this.req_urlInfos.searchParams;

        if (searchParams.size) {
            const t: any = res.searchParams = {};
            searchParams.forEach((value, key) => t[key] = value);
        }

        if (this.req_urlParts) {
            res.urlParts = { ...this.req_urlParts };
        }

        if (this.req_isBodyJson) {
            try {
                res.body = await this.req_bodyAsJson();
            } catch {
                // If JSON is invalid.
            }
        } else if (this.req_isBodyFormData) {
            try {
                const t: any = res.formData = {};
                const asFormData = await this.req_bodyAsFormData();
                asFormData.forEach((value, key) => t[key] = value);
            } catch {
                // If FormData is invalid.
            }
        } else if (this.req_isBodyXFormUrlEncoded) {
            try {
                let data = await this.req_bodyAsText();
                const t: any = res.formUrlEncoded = {};
                new URLSearchParams(data).forEach((value, key) => t[key] = value);
            } catch {
                // If invalid.
            }
        }

        return res;
    }

    /**
     * https://developer.mozilla.org/en-US/docs/Web/API/Request/bodyUsed
     */
    get req_isBodyUsed(): boolean {
        return this.coreRequest.bodyUsed;
    }

    get req_isBodyJson(): boolean {
        const ct = this.req_contentType;
        if (ct === null) return false;
        return ct.startsWith("application/json");
    }

    get req_isBodyFormData(): boolean {
        const ct = this.req_contentType;
        if (ct === null) return false;
        return ct.startsWith("multipart/form-data");
    }

    get req_isBodyXFormUrlEncoded(): boolean {
        const ct = this.req_contentType;
        if (ct === null) return false;
        return ct.startsWith("application/x-www-form-urlencoded");
    }

    req_bodyAsText(): Promise<string> {
        return this.coreRequest.text();
    }

    async req_bodyAsJson<T = any>(dataSchema?: jk_schema.Schema): Promise<T> {
        if (dataSchema) {
            const data = await this.req_bodyAsJson();
            this.tool_validateDataSchema(data, dataSchema);
            return data;
        }

        return await this.coreRequest.json() as Promise<T>;
    }

    /**
     * Reads the request body as an ArrayBuffer.
     * @see https://developer.mozilla.org/en-US/docs/Web/API/Request/arrayBuffer
     */
    req_bodyAsArrayBuffer(): Promise<ArrayBuffer> {
        return this.coreRequest.arrayBuffer();
    }

    /**
     * Reads the request body as a Blob.
     * @see https://developer.mozilla.org/en-US/docs/Web/API/Request/blob
     */
    req_bodyAsBlob(): Promise<Blob> {
        return this.coreRequest.blob();
    }

    /**
     * Reads the request body as a Uint8Array (Bytes).
     * @see https://developer.mozilla.org/en-US/docs/Web/API/Request/bytes
     */
    req_bodyAsBytes(): Promise<Uint8Array> {
        return this.coreRequest.bytes();
    }

    /**
     * Reads the request body as FormData.
     * @see https://developer.mozilla.org/en-US/docs/Web/API/Request/formData
     */
    req_bodyAsFormData(): Promise<FormData> {
        return this.coreRequest.formData();
    }

    //endregion

    //region Request timeout

    /**
     * Extends the default request timeout.
     *
     * JopiJS imposes a default timeout (e.g., 60 seconds) to protect against DDoS attacks
     * and long-hanging requests. Use this method if you expect a specific request 
     * (like a large file upload or complex calculation) to take longer.
     * 
     * Warning: works only with Bun.js runtime.
     *
     * @param sec The new timeout duration in seconds.
     */
    req_extendTimeout_sec(sec: number) {
        this.coreServer.timeout(this.coreRequest, sec);
    }

    //endregion

    //region Response helpers

    /**
     * Creates a redirect response (HTTP 301 or 302).
     * @param url The URL to redirect to.
     * @param permanent If true, uses status code 301 (Moved Permanently). Otherwise, 302 (Found).
     */
    res_redirect(url: string | URL, permanent: boolean = false): Response {
        return new Response(null, { status: permanent ? 301 : 302, headers: { "location": url.toString() } });
    }

    /**
     * Creates a plain text response.
     * @param text The text content.
     * @param statusCode HTTP status code (default: 200).
     */
    res_textResponse(text: string, statusCode: number = 200) {
        return new Response(text, { status: statusCode, headers: { "content-type": "text/plain;charset=utf-8" } });
    }

    /**
     * Creates a JSON response with a standard structure: `{ isOk, message }`.
     * @param isOk Indicates success or failure.
     * @param message Arbitrary data or message to include.
     */
    res_returnResultMessage(isOk: boolean, message?: any): Response {
        return this.res_jsonResponse({ isOk, message });
    }

    /**
     * Creates an HTML response.
     * @param html The HTML string.
     * @param statusCode HTTP status code (default: 200).
     */
    res_htmlResponse(html: string, statusCode: number = 200): Response {
        return new Response(html, { status: statusCode, headers: { "content-type": "text/html;charset=utf-8" } });
    }

    /**
     * Creates a JSON response.
     * @param json The object to serialize to JSON.
     * @param statusCode HTTP status code (default: 200).
     */
    res_jsonResponse(json: any, statusCode: number = 200): Response {
        return new Response(JSON.stringify(json), {
            status: statusCode,
            headers: { "content-type": "application/json;charset=utf-8" }
        });
    }

    /**
     * Creates a JSON response from a pre-serialized JSON string.
     * @param json The JSON string.
     * @param statusCode HTTP status code (default: 200).
     */
    res_jsonStringResponse(json: string, statusCode: number = 200): Response {
        return new Response(json, { status: statusCode, headers: { "content-type": "application/json;charset=utf-8" } });
    }

    /**
     * Returns a standard 404 Not Found response using the website's 404 handler.
     */
    res_returnError404_NotFound(): Promise<Response> {
        return this.webSite.return404(this);
    }

    /**
     * Returns a standard 500 Server Error response using the website's error handler.
     * @param error Optional error details or message.
     */
    res_returnError500_ServerError(error?: any | string): Promise<Response> {
        return this.webSite.return500(this, error);
    }

    /**
     * Returns a standard 401 Unauthorized response using the website's handler.
     * @param error Optional error details.
     */
    res_returnError401_Unauthorized(error?: Error | string): Promise<Response> {
        return this.webSite.return401(this, error);
    }

    /**
     * Returns a simple 400 Bad Request response.
     * @param error Optional error message.
     */
    res_returnError400_BadRequest(error?: Error | string): Promise<Response> {
        return Promise.resolve(new Response(error ? error.toString() : "Bad request", { status: 400 }));
    }

    //endregion

    //region Fetch / Proxy

    //region Fetch / Proxy

    /**
     * Proxies the current request directly to the backend server defined in the load balancer.
     */
    proxy_directProxyToServer(): Promise<Response> {
        return this.webSite.loadBalancer.directProxy(this);
    }

    /**
     * Proxies the current request to a specific server instance.
     * @param server The target server to proxy to.
     */
    proxy_proxyRequestTo(server: ServerFetch<any>): Promise<Response> {
        return server.directProxy(this);
    }

    /**
     * Alias for `proxy_proxyRequestTo`. Proxies to a specific server.
     * @param server The target server.
     */
    proxy_directProxyWith(server: ServerFetch<any>): Promise<Response> {
        return server.directProxy(this);
    }

    /**
     * Performs a fetch request using the website's load balancer logic.
     * @param headers Optional custom headers.
     * @param method HTTP method (default: GET).
     * @param url Target URL (default: current request URL).
     * @param body Optional request body.
     */
    proxy_fetchServer(headers?: Headers, method: string = "GET", url?: URL, body?: RequestBody): Promise<Response> {
        if (!url) url = this.req_urlInfos;
        return this.webSite.loadBalancer.fetch(method, url, body, headers);
    }

    //endregion

    //region Cache

    protected _isAddedToCache = false;
    protected _cache_ignoreDefaultBehaviors = false;
    protected _cache_ignoreCacheRead = false;
    protected _cache_ignoreCacheWrite = false;

    /**
     * Disables the default automatic caching behavior for this request.
     * Useful when you want manual control over when to cache.
     */
    cache_ignoreDefaultBehaviors() {
        this._cache_ignoreDefaultBehaviors = true;
    }

    /**
     * Forces the request to bypass the cache read step.
     * The request will be processed as if the cache entry does not exist.
     */
    cache_ignoreCacheRead() {
        this._cache_ignoreCacheRead = true;
    }

    /**
     * Prevents the response from being written to the cache.
     */
    cache_ignoreCacheWrite() {
        this._cache_ignoreCacheWrite = true;
    }


    /**
     * Manually retrieves the cache entry for the current URL.
     * @returns The cached response if found, otherwise undefined.
     */
    async cache_getFromCache(): Promise<Response | undefined> {
        return await this.cache.getFromCache(this, this.req_urlInfos);
    }

    /**
     * Checks if a valid cache entry exists for the current URL.
     */
    async cache_hasInCache(): Promise<boolean> {
        return await this.cache.hasInCache(this.req_urlInfos);
    }

    /**
     * Manually removes the cache entry for a specific URL or the current one.
     * Normalizes the URL hostname and pathname to lowercase before removal.
     * @param url Optional URL to invalidate. Defaults to the current request URL.
     */
    cache_removeFromCache(url?: URL): Promise<void> {
        // Avoid double.
        //
        if (!url) {
            url = this.req_urlInfos;
            url.hostname = url.hostname.toLowerCase();
            url.pathname = url.pathname.toLowerCase();
        }

        return this.cache.removeFromCache(url || this.req_urlInfos);
    }

    /**
     * Manually adds a response to the cache for the current request.
     * Prevents duplicate additions within the same request lifecycle.
     * @param response The response object to cache.
     */
    cache_addToCache(response: Response) {
        // Avoid adding two times in the same request.
        // This is required with automatic add functionnality.
        //
        if (this._isAddedToCache) return;
        this._isAddedToCache = false;

        return this.cache.addToCache(this, this.req_urlInfos, response, this.webSite.getHeadersToCache());
    }

    /**
     * Swaps the current cache instance with a different one.
     * Useful for implementing user-specific or segmented caches.
     * @param cache The new PageCache instance to use.
     */
    cache_useCache(cache: PageCache) {
        this.cache = cache;
    }

    /**
     * Creates and returns a sub-cache derived from the current cache.
     * @param name The name/namespace of the sub-cache.
     */
    cache_getSubCache(name: string): PageCache {
        return this.cache.createSubCache(name);
    }

    /**
     * Returns an iterator over all entries in the current cache.
     */
    cache_getCacheEntryIterator(): Iterable<CacheEntry> {
        return this.cache.getCacheEntryIterator();
    }

    //endregion

    //region Test type / React on type

    /**
     * Retrieves the Content-Type header from a response.
     */
    resValue_getContentTypeOf(response: Response): string | null {
        return response.headers.get("content-type");
    }

    /**
     * Categorizes the response content type into a simpler enum (HTML, JSON, Image, etc.).
     * @param response The response to analyze.
     */
    resValue_getContentTypeCategory(response: Response): ContentTypeCategory {
        const contentType = response.headers.get("content-type");
        if (!contentType) return ContentTypeCategory.OTHER;

        if (contentType.startsWith("text/")) {
            if (contentType.startsWith("html", 5)) {
                return ContentTypeCategory.TEXT_HTML;
            } else if (contentType.startsWith("css")) {
                return ContentTypeCategory.TEXT_CSS;
            } else if (contentType.startsWith("javascript", 5)) {
                return ContentTypeCategory.TEXT_JAVASCRIPT;
            } else if (contentType.startsWith("json")) {
                return ContentTypeCategory.TEXT_JSON;
            }
        } else if (contentType.startsWith("image")) {
            return ContentTypeCategory.IMAGE;
        } else if (contentType.startsWith("application")) {
            if (contentType.startsWith("x-www-form-urlencoded", 12)) {
                return ContentTypeCategory.FORM_URL_ENCODED;
            } else if (contentType.startsWith("json", 12)) {
                return ContentTypeCategory.TEXT_JSON;
            } else if (contentType.startsWith("javascript", 12)) {
                return ContentTypeCategory.TEXT_JAVASCRIPT;
            }
        } else if (contentType.startsWith("multipart/form-data")) {
            return ContentTypeCategory.FORM_MULTIPART;
        }

        return ContentTypeCategory.OTHER;
    }

    /**
     * Checks if the response content type is HTML (text/html).
     */
    resValue_isHtml(response: Response): boolean {
        const contentType = response.headers.get("content-type");
        if (contentType === null) return false;
        return contentType.startsWith("text/html");
    }

    /**
     * Checks if the response content type is CSS (text/css).
     */
    resValue_isCss(response: Response): boolean {
        const contentType = response.headers.get("content-type");
        if (contentType === null) return false;
        return contentType.startsWith("text/css");
    }

    /**
     * Checks if the response content type is JavaScript.
     */
    resValue_isJavascript(response: Response): boolean {
        const contentType = response.headers.get("content-type");
        if (contentType === null) return false;
        return contentType.startsWith("application/javascript") || contentType.startsWith("text/javascript");
    }

    /**
     * Checks if the response content type is JSON.
     */
    resValue_isJson(response: Response): boolean {
        const contentType = response.headers.get("content-type");
        if (contentType === null) return false;
        return contentType.startsWith("application/json");
    }

    /**
     * Checks if the response content type is 'application/x-www-form-urlencoded'.
     */
    resValue_isXFormUrlEncoded(response: Response): boolean {
        const contentType = response.headers.get("content-type");
        if (contentType === null) return false;
        return contentType.startsWith("x-www-form-urlencoded");
    }

    /**
     * Applies text modifiers to the response if it is HTML.
     * Useful for injecting content or transforming HTML before sending to the client.
     */
    async resValue_hookIfHtml(res: Response, ...hooks: TextModifier[]): Promise<Response> {
        if (this.resValue_isHtml(res)) {
            if (isNodeJS) {
                let headers = new Headers(res.headers);
                headers.delete("content-length");
                headers.delete("content-encoding");

                let newHTML = await this.resValue_applyTextModifiers(res, hooks);
                return new Response(newHTML, { status: res.status, headers });
            }
            else {
                res.headers.delete("content-length");
                res.headers.delete("content-encoding");

                return new Response(
                    await this.resValue_applyTextModifiers(res, hooks),
                    { status: res.status, headers: res.headers }
                );
            }
        }

        return Promise.resolve(res);
    }

    /**
     * Applies text modifiers to the response if it is CSS.
     */
    async resValue_hookIfCss(res: Response, ...hooks: TextModifier[]): Promise<Response> {
        if (this.resValue_isCss(res)) {
            return new Response(
                await this.resValue_applyTextModifiers(res, hooks),
                { status: res.status, headers: res.headers }
            );
        }

        return Promise.resolve(res);
    }

    /**
     * Applies text modifiers to the response if it is JavaScript.
     */
    async resValue_hookIfJavascript(res: Response, ...hooks: TextModifier[]): Promise<Response> {
        if (this.resValue_isJavascript(res)) {
            return new Response(
                await this.resValue_applyTextModifiers(res, hooks),
                { status: res.status, headers: res.headers }
            );
        }

        return Promise.resolve(res);
    }

    /**
     * Helper to apply a series of text modifier functions to a response's body.
     */
    async resValue_applyTextModifiers(res: Response, hooks: TextModifier[]): Promise<string> {
        let text = await res.text() as string;

        for (const hook of hooks) {
            const hRes = hook(text, this);
            text = hRes instanceof Promise ? await hRes : hRes;
        }

        return text;
    }

    /**
     * Executes a series of modifiers on the response object itself.
     * Unlike `resValue_applyTextModifiers` which works on the body text, this can modify headers, status, etc.
     * @param res The response to modify.
     * @param hooks Array of modifier functions.
     */
    async resValue_executeModifiers(res: Response, hooks: ResponseModifier[]): Promise<Response> {
        for (const hook of hooks) {
            const hRes = hook(res, this);
            res = hRes instanceof Promise ? await hRes : hRes;
        }

        return res;
    }

    /**
     * Replaces the current website's origin in the response headers (Location) and body (if HTML).
     * Useful when the server is behind a proxy or running on a different internal port / hostname.
     * @param res The response to modify.
     * @param toReplace The string/origin to find and replace.
     * @param redirectionCode Optional status code to use if a redirect occurs.
     */
    async resValue_replaceWebSiteOrigin(res: Response, toReplace: string, redirectionCode?: number): Promise<Response> {
        let location = res.headers.get("location");

        if (location) {
            const thisOrigin = this.webSite.getWelcomeUrl();
            location = location.replace(toReplace, thisOrigin);
            if (location.startsWith("/")) location = thisOrigin + location;
            res = Response.redirect(location, redirectionCode ? redirectionCode : res.status);
        } else {
            // It's a helper function that allows decoding
            // and re-encoding a response if his content is of type HTML.
            //
            res = await this.resValue_hookIfHtml(res, (html) => {
                const thisOrigin = this.webSite.getWelcomeUrl();
                return html.replaceAll(toReplace, thisOrigin);
            });
        }

        return res;
    }

    //endregion

    //region Tools


    /**
     * Validate the data Schema.
     * If invalid, throw a special exception allowing
     * to directly send a response to the caller.
     */
    private tool_validateDataSchema(data: any, schema: jk_schema.Schema) {
        let error = jk_schema.validateSchema(data, schema);

        if (error) {
            throw new SBPE_DirectSendThisResponseException(() => {
                return this.res_returnError400_BadRequest("Invalid data")
            });
        }
    }

    /**
     * Duplicates a ReadableStream (e.g., request body).
     * Essential because a stream can only be read once.
     */
    async tool_duplicateReadableStream(stream: ReadableStream | null): Promise<(ReadableStream<any> | null)[]> {
        if (!stream) return [null, null];
        return stream.tee();
    }

    /**
     * Clones a Request object, ensuring the body stream is also duplicated so both requests can be read.
     * @returns A tuple containing two identical Request objects.
     */
    async tool_duplicateRawRequest(raw: Request): Promise<[Request, Request]> {
        const [str1, str2] = await this.tool_duplicateReadableStream(raw.body);

        const res1 = new Request(raw.url, {
            body: str1,
            headers: raw.headers,
            method: raw.method
        });

        const res2 = new Request(raw.url, {
            body: str2,
            headers: raw.headers,
            method: raw.method
        });

        return [res1, res2];
    }

    /**
     * Clones a Response object, ensuring the body stream is duplicated.
     * @returns A tuple containing two identical Response objects.
     */
    async tool_duplicateResponse(raw: Response): Promise<[Response, Response]> {
        const [str1, str2] = await this.tool_duplicateReadableStream(raw.body);

        const res1 = new Response(str1, {
            status: raw.status,
            headers: raw.headers
        });

        const res2 = new Response(str2, {
            status: raw.status,
            headers: raw.headers
        });

        return [res1, res2];
    }

    /**
     * Executes a request handler while "spying" on the inputs and outputs.
     * Defaults to printing the spy data to the console.
     * @param handleRequest The function to execute.
     */
    async tool_spyRequest(handleRequest: (req: JopiRequest) => Promise<Response>): Promise<Response> {
        return this.tool_spyRequestData(handleRequest, (data) => {
            this.tool_printSpyRequestData(data);
        });
    }

    /**
     * Formats and prints the spy data (request/response details) to the console with colors.
     */
    async tool_printSpyRequestData(data: JopiRequestSpyData) {
        const headerColor = jk_term.buildWriter(jk_term.C_RED);
        const titleColor = jk_term.buildWriter(jk_term.C_ORANGE);

        let resAsText = "";
        //
        try {
            if (data.res) {
                let res = data.res();
                if (!res) resAsText = "[NO SET]";
                else resAsText = await res.text()
            } else {
                resAsText = "[NO SET]";
            }
        } catch {
        }

        console.log();
        console.log(headerColor(this.req_method, this.req_url));
        console.log(titleColor("|- referer: "), data.reqReferer);
        console.log(titleColor("|- req_contentType:"), data.req_contentType);
        console.log(titleColor("|- reqData:"), data.reqData);
        console.log(titleColor("|- reqCookie:"), data.reqCookies);
        console.log(titleColor("|- resContentType:"), data.resContentType);
        console.log(titleColor("|- resCookieSet:"), data.resCookieSet);
        console.log(titleColor("|- resHeaders:"), data.resHeaders);
        console.log(titleColor("|- resData:"), resAsText);
    }

    /**
     * Core spying method. Duplicates the request to allow reading it without consuming the original.
     * Executes the handler, duplicates the response, and calls the `onSpy` callback with gathered data.
     * @param handleRequest The request handler.
     * @param onSpy Callback to receive the spy data.
     */
    async tool_spyRequestData(handleRequest: JopiRouteHandler, onSpy: JopiRequestSpy): Promise<Response> {
        const [bunNewReq, spyReq] = await this.tool_duplicateRawRequest(this.coreRequest);

        // Required because the body is already consumed.
        this.coreRequest = bunNewReq;

        let res = await handleRequest(this);
        const [bunNewRes, spyRes] = await this.tool_duplicateResponse(res);

        // Required because the body is already consumed.
        this.coreRequest = spyReq;

        onSpy({
            method: this.req_method,
            res: () => spyRes,

            reqUrl: this.req_url,
            reqReferer: this.req_headers.get("referer"),
            req_contentType: this.req_contentType,
            reqData: await this.req_getDataInfos(),
            resContentType: res.headers.get("content-type"),
            resContentTypeCat: this.resValue_getContentTypeCategory(res),

            reqCookies: this.req_headers.get("cookie"),
            resCookieSet: spyRes.headers.getSetCookie(),

            resStatus: spyRes.status,
            resLocation: spyRes.headers.get("location"),
            resHeaders: spyRes.headers
        }, this);

        return bunNewRes;
    }

    /**
     * Applies search parameters filtering logic.
     * If a filter is provided, it's used; otherwise, it checks if the route has a defined filter.
     */
    tool_filterSearchParams(filter?: SearchParamFilterFunction) {
        if (filter) {
            filter(this.req_urlInfos);
        } else {
            if (this.routeInfos.searchParamFilter) {
                this.routeInfos.searchParamFilter(this.req_urlInfos);
            }
        }
    }

    //endregion

    //region Post process

    protected postProcess: ((res: Response) => Response)[] | undefined;

    //endregion

    //region Cookies

    private isFakingNoCookies = false;

    cookie_fakeNoCookies() {
        this.isFakingNoCookies = true;
    }

    private _allCookies?: Record<string, string>;

    cookie_getAllCookies(): Record<string, string> {
        if (this.isFakingNoCookies) return {};
        
        if (this._allCookies===undefined) {
            this._allCookies = parseCookies(this.coreRequest.headers);
        }

        return this._allCookies;
    }

    /**
     * Checks if a cookie is present in the request.
     * @param name The name of the cookie.
     * @param value Optional value to check against (returns true only if name AND value match).
     */
    cookie_reqHasCookie(name: string, value?: string): boolean {
        if (this.isFakingNoCookies) return false;
        const cookies = this.cookie_getAllCookies();

        if (value) return cookies[name] === value;
        return cookies[name] !== undefined;
    }

    /**
     * Retrieves the value of a cookie from the request.
     * @param name The name of the cookie.
     */
    cookie_getReqCookie(name: string): string | undefined {
        if (this.isFakingNoCookies) return undefined;
        const cookies = this.cookie_getAllCookies();
        return cookies[name];
    }

    /**
     * Deletes a cookie on the client side by setting its max-age to -1.
     * @param name The name of the cookie to delete.
     */
    cookie_deleteResCookie(name: string) {
        this.cookie_addCookieToRes(name, "", { maxAge: -1 });
    }

    /**
     * Adds a Set-Cookie header to the response.
     * Utilizes a post-process hook to ensure it's added to the final response.
     * @param cookieName Name of the cookie.
     * @param cookieValue Value of the cookie.
     * @param options Cookie options (e.g., maxAge).
     */
    cookie_addCookieToRes(cookieName: string, cookieValue: string, options?: CookieOptions) {
        let cookie = `${cookieName}=${cookieValue};`;

        options = {
            path: "/",
            maxAge: 315360000, // 10 years
            ...this.webSite.cookieDefaults,
            ...options
        };

        if (options) {
            if (options.maxAge) cookie += ` Max-Age=${options.maxAge};`;
            if (options.expires) cookie += ` Expires=${options.expires.toUTCString()};`;
            if (options.path) cookie += ` Path=${options.path};`;
            if (options.domain) cookie += ` Domain=${options.domain};`;
            if (options.secure) cookie += ` Secure;`;
            if (options.httpOnly) cookie += ` HttpOnly;`;
            if (options.sameSite) cookie += ` SameSite=${options.sameSite};`;
            if (options.priority) cookie += ` Priority=${options.priority};`;
        }

        if (!this.postProcess) this.postProcess = [];

        this.postProcess.push((res: Response) => {
            let current = res.headers.get("set-cookie");
            if (current) cookie = current + cookie;

            // With node, res.headers is immutable.
            // And a Response object is also immutable.
            // It's why we need to create a new response.
            //
            if (jk_what.isNodeJS) {
                const headers = new Headers(res.headers);
                headers.append("set-cookie", cookie);

                res = new Response(res.body, {
                    headers: headers,
                    status: res.status
                });
            } else {
                res.headers.append("set-cookie", cookie);
            }

            return res;
        });
    }

    //endregion

    //region ReactJS

    /**
     * Renders a React component to a full HTML response.
     * Uses `renderToStaticMarkup` for server-side rendering.
     * @param E The React Node (component) to render.
     */
    react_toResponse(E: ReactNode) {
        return this.res_htmlResponse(ReactServer.renderToStaticMarkup(E));
    }

    /**
     * Renders a React element to a static HTML string.
     * @param element The React Node to render.
     */
    react_toString(element: ReactNode): string {
        return ReactServer.renderToStaticMarkup(element);
    }

    protected _pageData: PageDataProviderData | undefined;

    /**
     * Retrieves the data pre-fetched for the page (if any).
     * This data is typically injected during the build/render process.
     */
    react_getPageData(): PageDataProviderData | undefined {
        return this._pageData;
    }

    //endregion

    //region JQuery

    /**
     * Parses an HTML string into a Cheerio (jQuery-like) object.
     * Useful for manipulating HTML content on the server.
     * @param html The HTML string to parse.
     */
    jquery_htmlToJquery(html: string) {
        const res = cheerio.load(html);
        initCheerio(res);
        return res;
    }

    //endregion

    //region JWT Tokens

    /**
     * Creates a signed JWT token containing the provided user information.
     * @param data The user information to encode in the token.
     */
    user_createJwtToken(data: UserInfos): string | undefined {
        return this.userJwtToken = this.webSite.createJwtToken(data);
    }

    /**
     * Retrieves the JWT token from the request.
     * Checks the "Authorization" header (Bearer token) and the "authorization" cookie.
     */
    user_getJwtToken(): string | undefined {
        if (this.userJwtToken) {
            return this.userJwtToken;
        }

        if (this.hasNoUserInfos) {
            return undefined;
        }

        let authHeader = this.req_headers.get("authorization");

        if (authHeader) {
            if (authHeader.startsWith("Bearer ")) {
                return this.userJwtToken = authHeader.slice(7);
            }
        }

        let authCookie = this.cookie_getReqCookie("authorization");

        if (authCookie) {
            if (authCookie.startsWith("jwt ")) {
                return this.userJwtToken = authCookie.slice(4);
            }
        }

        return undefined;
    }

    /**
     * Attempts to authenticate the user using the provided login credentials.
     * If successful, generates a JWT token and sets it as an "authorization" cookie.
     *
     * @param loginInfo Credentials (e.g., username/password) matching the website's login manager.
     * @returns An AuthResult object indicating success or failure.
     */
    async user_tryAuthWithJWT<T = LoginPassword>(loginInfo: T): Promise<AuthResult> {
        const authResult = await this.webSite.tryAuthUser(loginInfo);

        if (authResult.isOk) {
            if (!authResult.authToken) {
                authResult.authToken = this.user_createJwtToken(authResult.userInfos!);
            }

            // The token will be added to cookie "authorization" in the post-process step.
            this.userJwtToken = authResult.authToken;
            this.userInfos = authResult.userInfos!;

            this.webSite.storeJwtToken(this);

            return authResult;
        }

        this.userInfos = undefined;
        this.userJwtToken = undefined;

        return authResult;
    }

    /**
     * Verify and decode the JWT token.
     * Once done, the data is saved and can be read through req.userTokenData.
     */
    private user_decodeJwtToken(): UserInfos | undefined {
        const token = this.user_getJwtToken();
        if (!token) return undefined;

        return this.webSite.decodeJwtToken(this, token);
    }

    /**
     * Logs the user out by deleting the "authorization" session cookie.
     * Note: This only affects browser clients that respect cookies.
     */
    public user_logOutUser() {
        this.cookie_deleteResCookie("authorization");
    }

    /**
     * Simulates a state where no user is logged in for the current request.
     * Useful for generating generic/anonymous versions of a page for caching.
     */
    public user_fakeNoUsers() {
        this.isFakingNoUsers = true;
    }

    /**
     * Retrieves the information of the currently authenticated user.
     * @returns The UserInfos object if authenticated, otherwise undefined.
     */
    public user_getUserInfos(): UserInfos | undefined {
        if (this.isFakingNoUsers) return undefined;

        if (this.userInfos) return this.userInfos;
        if (this.hasNoUserInfos) return undefined;

        const userInfos = this.user_decodeJwtToken();

        if (userInfos) {
            this.userInfos = userInfos;
            return userInfos;
        }

        this.hasNoUserInfos = true;
        return undefined;
    }

    /**
     * Retrieves the authenticated user's information.
     * @throws {SBPE_NotAuthorizedException} if the user is not authenticated.
     */
    public use_requireUserInfos(): UserInfos {
        let userInfos = this.user_getUserInfos();
        if (!userInfos) throw new SBPE_NotAuthorizedException();
        return userInfos;
    }

    private isFakingNoUsers: boolean = false;
    private hasNoUserInfos: boolean = false;
    private userInfos?: UserInfos;
    private userJwtToken?: string;

    //endregion

    //region User roles

    /**
     * Returns the list of roles assigned to the currently authenticated user.
     * @returns An array of role strings. Returns empty array if not authenticated.
     */
    public role_getUserRoles(): string[] {
        const userInfos = this.user_getUserInfos();
        if (!userInfos || !userInfos.roles) return [];
        return userInfos.roles;
    }

    /**
     * Checks if the user possesses at least one of the specified roles.
     * @param requiredRoles Array of roles to check against.
     * @returns True if the user has any of the roles, false otherwise.
     */
    public role_userHasOneOfThisRoles(requiredRoles: string[]): boolean {
        const userInfos = this.user_getUserInfos();
        if (!userInfos) return false;

        const userRoles = userInfos.roles;
        if (!userRoles) return false;

        for (let role of userRoles) {
            if (requiredRoles.includes(role)) return true;
        }

        return false;
    }

    /**
     * Checks if the user possesses a specific role.
     * @param requiredRole The role to check.
     * @returns True if the user has the role, false otherwise.
     */
    public role_userHasRole(requiredRole: string): boolean {
        const userInfos = this.user_getUserInfos();
        if (!userInfos) return false;

        const userRoles = userInfos.roles;
        if (!userRoles) return false;

        return userRoles.includes(requiredRole);
    }

    /**
     * Asserts that the user possesses at least one of the specified roles.
     * If the check fails, throws a `SBPE_NotAuthorizedException` (401).
     * @param requiredRoles Array of roles to check.
     */
    public role_assertUserHasOneOfThisRoles(requiredRoles: string[]) {
        if (!this.role_userHasOneOfThisRoles(requiredRoles)) {
            throw new SBPE_NotAuthorizedException();
        }
    }

    /**
     * Asserts that the user possesses a specific role.
     * If the check fails, throws a `SBPE_NotAuthorizedException` (401).
     * @param requiredRole The role to check.
     */
    public role_assertUserHasRole(requiredRole: string) {
        if (!this.role_userHasRole(requiredRole)) {
            throw new SBPE_NotAuthorizedException();
        }
    }

    //endregion

    //region File Serving

    /**
     * Determines the absolute path of a file and sends it as a response.
     * Uses the website's cache mechanisms to validate and serve the file.
     * @param filePath The absolute path to the file.
     * @param params Optional parameters (e.g., content encoding).
     */
    async file_returnFile(filePath: string, params?: ReqReturnFileParams): Promise<Response> {
        const res = await this.file_tryReturnFile(filePath, params);
        if (res) return res;

        return this.res_returnError404_NotFound();
    }

    /**
     * Serves a file located relative to the current module's directory.
     * @param relFilePath The relative path to the file.
     * @param importMeta The ImportMeta object of the calling module (provides `dirname`).
     * @param params Optional parameters.
     */
    async file_returnRelFile(relFilePath: string, importMeta: { dirname: string }, params?: ReqReturnFileParams): Promise<Response> {
        return this.file_returnFile(jk_fs.join(importMeta.dirname, relFilePath), params);
    }

    /**
     * Attempts to find and serve a file.
     * Returns `undefined` if the file doesn't exist, instead of a 404 response.
     * Handles browser cache validation (304 Not Modified).
     * @param filePath Absolute path to the file.
     * @param params Optional parameters.
     */
    async file_tryReturnFile(filePath: string, params?: ReqReturnFileParams): Promise<Response | undefined> {
        let cacheValidationInfos = await this.file_validateCacheHeaders(filePath);

        // Mean that the file doesn't exist.
        if (cacheValidationInfos === undefined) return undefined;

        // Mean that the browser cache is valid. Returns code 304.
        if (cacheValidationInfos instanceof Response) return cacheValidationInfos;

        // Will return the file and add the browser cache headers.
        return this.webSite.tryReturnFile({
            req: this,
            filePath,
            contentEncoding: params?.contentEncoding,
            validationInfos: cacheValidationInfos
        });
    }

    /**
     * Serves static files from a directory, mirroring the URL structure.
     * E.g., request `/assets/img.png` -> serves file at `filesRootPath/assets/img.png`.
     * Uses an internal cache (`WebSiteMirrorCache`) for performance.
     *
     * @param filesRootPath The root directory on the filesystem to serve files from.
     * @param options Configuration options (e.g. handle Not Found, manage index.html).
     */
    async file_serveFromDir(filesRootPath: string, options?: ServeFileOptions): Promise<Response> {
        options = options || gEmptyObject;

        if (options.replaceIndexHtml !== false) {
            if (this.req_urlInfos.pathname.endsWith("/index.html")) {
                this.req_urlInfos.pathname = this.req_urlInfos.pathname.slice(0, -10);
                return this.res_redirect(this.req_urlInfos, false);
            }

            if (this.req_urlInfos.pathname.endsWith("/")) {
                this.req_urlInfos.pathname += "index.html";
            }
        }

        const sfc = new WebSiteMirrorCache(filesRootPath);
        const fromCache = await sfc.getFromCache(this, this.req_urlInfos);
        if (fromCache) return fromCache;

        if (options.onNotFound) {
            return options.onNotFound(this);
        }

        return this.res_returnError404_NotFound();
    }

    /**
     * Calculates the ETag (Entity Tag) hash for a file.
     * Used for cache validation.
     * @param filePath The absolute path to the file.
     */
    file_calcFileEtag(filePath: string): Promise<string | undefined> {
        return jk_fs.calcFileHash(filePath);
    }

    /**
     * Validates cache headers against a provided set of headers.
     * Checks `If-None-Match` (ETag) and `If-Modified-Since`.
     * @param headers Object containing `etag` and `if-modified-since` keys.
     * @returns A 304 Response if cache is valid, otherwise undefined.
     */
    file_validateCacheHeadersWith(headers: any): Response | undefined {
        let reqEtag = this.req_headers.get("if-none-match")
        let myEtag = headers["etag"];

        if (reqEtag && (reqEtag === myEtag)) {
            return new Response(null, {
                status: 304,
                headers: { "etag": myEtag }
            });
        }

        let reqLastModifiedSince = this.req_headers.get("if-modified-since");
        let myLastModifiedSince = headers["if-modified-since"];

        if (myLastModifiedSince && reqLastModifiedSince) {
            const dMyLastModifiedSince = new Date(myLastModifiedSince).getTime();
            const dReqLastModifiedSince = new Date(reqLastModifiedSince).getTime();

            if (dReqLastModifiedSince < dMyLastModifiedSince) {
                return new Response(null, {
                    status: 304,
                    headers: { "last-modified": myLastModifiedSince }
                });
            }
        }
    }

    /**
     * Validates if a file on disk matches the client's cache headers.
     * @param filePath Absolute path to the file.
     * @returns 
     * - `undefined`: File does not exist.
     * - `Response` (304): Client has the latest version.
     * - `BrowserCacheValidationInfos`: File exists and is newer; returns file stats and ETag.
     */
    async file_validateCacheHeaders(filePath: string): Promise<BrowserCacheValidationInfos | Response | undefined> {
        let fileState = await jk_fs.getFileStat(filePath);
        if (!fileState) return undefined;

        let lastModifiedSince = this.req_headers.get("if-modified-since");

        if (lastModifiedSince) {
            const fileModifiedTime = new Date(fileState.mtimeMs).getTime();
            const clientModifiedTime = new Date(lastModifiedSince).getTime();

            if (fileModifiedTime <= clientModifiedTime) {
                return new Response(null, {
                    status: 304,
                    headers: { "last-modified": new Date(fileState.mtimeMs).toUTCString() }
                });
            }
        }

        let etag = this.req_headers.get("if-none-match")
        let calcEtag: string | undefined;

        if (etag) {
            calcEtag = await jk_fs.calcFileHash(filePath);

            if (etag === calcEtag) {
                return new Response(null, {
                    status: 304,
                    headers: { "etag": etag }
                });
            }
        }

        if (!calcEtag) calcEtag = await jk_fs.calcFileHash(filePath);
        return { etag: calcEtag!, fileState: fileState! }
    }

    //endregion
}

export class JopiRequestImpl extends JopiRequest {
    public _cache_ignoreDefaultBehaviors = false;
    public _cache_ignoreCacheRead = false;
    public _cache_ignoreCacheWrite = false;


    /**
     * Applies any registered post-process hooks to the response.
     * Hooks are typically used to add headers or cookies just before sending the response.
     * @param res The response to process.
     */
    _applyPostProcess(res: Response): Response {
        if (!this.postProcess) return res;
        this.postProcess.forEach(hook => res = hook(res));
        return res;
    }


    /**
     * Renders a full HTML page response from a React component, including all necessary scripts and styles.
     * Handles bundling (in dev mode), data injection, and page controller setup.
     * 
     * @param pageKey A unique identifier for the page (usually related to the route).
     * @param C The React functional component representing the page.
     */
    async react_fromPage(pageKey: string, C: React.FC<any>): Promise<Response> {
        try {
            let bundlePath = "/_bundle/";

            // When dev-mode (JOPI_DEV or JOPI_DEV_UI) then we compile the page one by one.
            //
            if (gIsSinglePageMode) {
                await createBundleForPage(pageKey, this.routeInfos.route);
                bundlePath += pageKey + "/";
            }

            // What we will include in our HTML.
            const options: PageOptions = {
                head: [{tag: "link", key: "jopi.mainBundle", rel: "stylesheet", type:"text/css", href: bundlePath + pageKey + ".css"}],
                bodyEnd: [{tag: "script", key: "jopi.mainScript", type: "module", src: bundlePath + pageKey + ".js"}]
            };

            const pageDataParams = this.routeInfos.pageDataParams;

            if (pageDataParams) {
                this._pageData = await pageDataParams.provider.getDataForCache.call(pageDataParams.provider, { req: this });

                const html = "window['JOPI_PAGE_DATA'] = " + JSON.stringify({
                    d: this._pageData,
                    u: pageDataParams.url
                });

                options.bodyEnd!.push({tag: "script", key: "jopi.pageData", content: html, type: "text/javascript"});
            }

            // Allow faking the environment of the page.
            const controller = new PageController_ExposePrivate<unknown>(
                false,
                this.webSite.mustRemoveTrailingSlashes,
                options
            );

            controller.setServerRequest(this);
            this.webSite.executeBrowserInstall(controller);

            const params = this.req_urlParts;
            const searchParams = this.req_urlInfos.searchParams;
            let jsonSearchParams: any;

            if (isNodeJS) {
                jsonSearchParams = {};
                searchParams.forEach((v, k) => jsonSearchParams[k] = v);
            } else {
                jsonSearchParams = searchParams.toJSON();
            }

            const html = ReactServer.renderToStaticMarkup(
                <Page controller={controller} >
                    <C params={params} searchParams={jsonSearchParams} />
                </Page>);

            return new Response(html, { status: 200, headers: { "content-type": "text/html;charset=utf-8" } });
        }
        catch (e: any) {
            if (!(e instanceof SBPE_ServerByPassException)) {
                console.error(e);
                return await this.res_returnError500_ServerError(e);
            } else {
                throw e;
            }
        }
    }
}

/**
 * Data structure collected when spying/logging a request.
 * Contains metadata about the request and response cycle.
 */
export interface JopiRequestSpyData {
    method: string;

    reqUrl: string;
    reqReferer: string | null;
    req_contentType: string | null;
    reqData: any;

    // Allow avoiding printing the response content.
    res: (() => Response) | undefined | null;

    resContentType: string | null;
    resContentTypeCat: ContentTypeCategory;

    resStatus: number;
    resLocation: string | null;
    resHeaders: Headers | undefined | null;

    reqCookies: string | null;
    resCookieSet: string[] | null;
}

/**
 * Callback function type for request spying/logging.
 */
export type JopiRequestSpy = (data: JopiRequestSpyData, req: JopiRequest) => void;

/**
 * Enum classifying content types into broad categories.
 * Useful for logging and conditional logic based on response type.
 */
export enum ContentTypeCategory {
    OTHER,

    _TEXT_ = 10,
    TEXT_HTML = 11,
    TEXT_CSS = 12,
    TEXT_JAVASCRIPT = 13,
    TEXT_JSON = 14,

    _FORM_ = 20,
    FORM_MULTIPART = 20,
    FORM_URL_ENCODED = 21,

    _BINARY_ = 30,
    IMAGE
}

const gEmptyObject = {};
const gIsSinglePageMode = getWebSiteConfig().isSinglePageMode;