// noinspection JSUnusedGlobalSymbols

import type {CoreServer, ServerSocketAddress} from "./jopiServer.ts";
import {ServerFetch} from "./serverFetch.ts";
import React, {type ReactNode} from "react";
import {PageController_ExposePrivate} from "jopijs/ui";
import * as ReactServer from "react-dom/server";
import * as cheerio from "cheerio";
import type {SearchParamFilterFunction} from "./searchParamFilter.ts";
import * as jk_schema from "jopi-toolkit/jk_schema";
import * as jk_what from "jopi-toolkit/jk_what";
import * as jk_fs from "jopi-toolkit/jk_fs";
import Page from "./PageComponent.tsx";

import {initCheerio} from "./jQuery.ts";
import {type CacheEntry, type PageCache} from "./caches/cache.ts";
import {
    type AuthResult,
    type CookieOptions, SBPE_DirectSendThisResponseException,
    type HttpMethod, type JopiRouteHandler, type LoginPassword, SBPE_NotAuthorizedException,
    type RequestBody,
    type ResponseModifier, type ServeFileOptions, type TestCookieValue, type TextModifier, type UserInfos,
    type WebSite,
    WebSiteImpl,
    type WebSiteRouteInfos
} from "./jopiWebSite.tsx";

import {parseCookies} from "./internalTools.ts";
import * as jk_term from "jopi-toolkit/jk_term";
import {isNodeJS} from "jopi-toolkit/jk_what";
import {isSinglePageMode} from "jopijs/loader-client";
import {createBundleForPage} from "./bundler/index.ts";
import {type BrowserCacheValidationInfos, type ReqReturnFileParams} from "./browserCacheControl.ts";
import {WebSiteMirrorCache} from "./caches/webSiteMirrorCache.ts";
import type {PageDataProviderData} from "jopijs/ui";

export class JopiRequest {
    public cache: PageCache;

    public readonly mainCache: PageCache;
    private cookies?: { [name: string]: string };
    private _headers: Headers;

    constructor(public readonly webSite: WebSite,
                private _urlInfos: URL|undefined,
                public coreRequest: Request,
                public readonly coreServer: CoreServer,
                public readonly routeInfos: WebSiteRouteInfos)
    {
        this.cache = (webSite as WebSiteImpl).mainCache;
        this.mainCache = this.cache;
        this._headers = this.coreRequest.headers;
    }

    //region Custom data

    get customData(): any {
        if (!this._customData) this._customData = {};
        return this._customData;
    }

    setCustomData(key: string, value: any) {
        if (!this._customData) this._customData = {};
        this._customData[key] = value;
    }

    getCustomData<T = any>(key: string): T | undefined {
        return this.customData[key];
    }

    //endregion

    //region Properties

    private _customData?: any;

    get urlInfos(): URL {
        if (!this._urlInfos) {
            this._urlInfos = new URL(this.coreRequest.url);
            this._urlInfos.hash = "";
        }

        return this._urlInfos;
    }

    /**
     * Return the verb used for the request (GET, POST, PUT, DELETE, ...)
     */
    get method(): HttpMethod {
        return this.coreRequest.method as HttpMethod;
    }

    /**
     * Return the content type of the request.
     */
    get reqContentType(): string | null {
        return this.coreRequest.headers.get("content-type");
    }

    get url(): string {
        return this.coreRequest.url;
    }

    get body(): RequestBody {
        return this.coreRequest.body;
    }

    get headers(): Headers {
        return this._headers;
    }

    set headers(value: Headers) {
        this._headers = value;
    }

    /**
     * The part of the url.
     * if : https://mywebsite/product-name/list
     * and route http://mywebsite/:product/list
     * then urlParts contains {product: "product-name"}
     */
    urlParts?: any;

    /**
     * Returns the url search params.
     * For "https://my-site/?sort=asc&filter=jopi", it returns {sort: "asc", filter: "jopi"}.
     */
    get urlSearchParams(): any {
        const sp = this.urlInfos.searchParams;
        if (!sp.size) return {};

        const res: any = {};
        sp.forEach((value, key) => res[key] = value);
        return res;
    }

    /**
     * Returns information on the caller IP.
     */
    get requestIP(): ServerSocketAddress | null {
        return this.coreServer.requestIP(this.coreRequest);
    }

    get isFromLocalhost() {
        const ip = this.requestIP;
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

    //region Request

    /**
     * Remove the hash (#this-part) and search params (?a=this-part) from the url.
     */
    req_clearSearchParamsAndHash() {
        this.urlInfos.search = "";
        this.urlInfos.hash = "";
    }

    //endregion

    //region Body transforming

    /**
     * Returns all the data about the request.
     * It's concat all data source.
     *
     * - The url parts.
     * - The search param (query string).
     * - The POST/PUT data if available.
     */
    async req_getData<T = any>(options?: {ignoreUrl?: boolean, dataSchema?: jk_schema.Schema}): Promise<T> {
        let res: any = {};

        if (!(options && options.ignoreUrl)) {
            const searchParams = this.urlInfos.searchParams;

            if (searchParams.size) {
                searchParams.forEach((value, key) => res[key] = value);
            }

            if (this.urlParts) {
                res = {...res, ...this.urlParts};
            }
        }

        if (this.req_isBodyJson) {
            try {
                const asJson = await this.req_bodyAsJson();
                if (asJson) res = {...res, ...asJson};
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
     * Get the request body and decode it properly.
     */
    async req_getBodyData<T = any>(options?: {dataSchema?: jk_schema.Schema}): Promise<T> {
        let res: any = {};

        if (this.req_isBodyJson) {
            try {
                const asJson = await this.req_bodyAsJson();
                if (asJson) res = {...res, ...asJson};
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

        const searchParams = this.urlInfos.searchParams;

        if (searchParams.size) {
            const t: any = res.searchParams = {};
            searchParams.forEach((value, key) => t[key] = value);
        }

        if (this.urlParts) {
            res.urlParts = {...this.urlParts};
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
        const ct = this.reqContentType;
        if (ct === null) return false;
        return ct.startsWith("application/json");
    }

    get req_isBodyFormData(): boolean {
        const ct = this.reqContentType;
        if (ct === null) return false;
        return ct.startsWith("multipart/form-data");
    }

    get req_isBodyXFormUrlEncoded(): boolean {
        const ct = this.reqContentType;
        if (ct === null) return false;
        return ct.startsWith("application/x-www-form-urlencoded");
    }

    req_bodyAsText(): Promise<string> {
        return this.coreRequest.text();
    }

    /**
     * Validate the data Schema.
     * If invalid, throw a special exception allowing
     * to directly send a response to the caller.
     */
    tool_validateDataSchema(data: any, schema: jk_schema.Schema) {
        let error = jk_schema.validateSchema(data, schema);

        if (error) {
            throw new SBPE_DirectSendThisResponseException(() => {
                return this.res_returnError400_BadRequest("Invalid data")
            });
        }
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
     * https://developer.mozilla.org/en-US/docs/Web/API/Request/arrayBuffer
     */
    req_bodyAsArrayBuffer(): Promise<ArrayBuffer> {
        return this.coreRequest.arrayBuffer();
    }

    /**
     * https://developer.mozilla.org/en-US/docs/Web/API/Request/blob
     */
    req_bodyAsBlob(): Promise<Blob> {
        return this.coreRequest.blob();
    }

    /**
     * https://developer.mozilla.org/en-US/docs/Web/API/Request/bytes
     */
    req_bodyAsBytes(): Promise<Uint8Array> {
        return this.coreRequest.bytes();
    }

    /**
     * https://developer.mozilla.org/en-US/docs/Web/API/Request/formData
     */
    req_bodyAsFormData(): Promise<FormData> {
        return this.coreRequest.formData();
    }

    //endregion

    //region Request timeout

    /**
     * When DDOS protection is enabled, the request has a timeout of 60 seconds.
     * Here it'd allow you to extend this time for a request you knew was slow.
     */
    req_extendTimeout_sec(sec: number) {
        this.coreServer.timeout(this.coreRequest, sec);
    }

    //endregion

    //region Response helpers

    /**
     * Create a redirection (301 permanent, or 302 temporary).
     */
    res_redirect(url: string | URL, permanent: boolean = false): Response {
        return new Response(null, {status: permanent ? 301 : 302, headers: {"location": url.toString()}});
    }

    res_textResponse(text: string, statusCode: number = 200) {
        return new Response(text, {status: statusCode, headers: {"content-type": "text/plain;charset=utf-8"}});
    }

    res_returnResultMessage(isOk: boolean, message?: any): Response {
        return this.res_jsonResponse({isOk, message});
    }

    res_htmlResponse(html: string, statusCode: number = 200): Response {
        return new Response(html, {status: statusCode, headers: {"content-type": "text/html;charset=utf-8"}});
    }

    res_jsonResponse(json: any, statusCode: number = 200): Response {
        return new Response(JSON.stringify(json), {
            status: statusCode,
            headers: {"content-type": "application/json;charset=utf-8"}
        });
    }

    res_jsonStringResponse(json: string, statusCode: number = 200): Response {
        return new Response(json, {status: statusCode, headers: {"content-type": "application/json;charset=utf-8"}});
    }

    res_returnError404_NotFound(): Promise<Response> {
        return this.webSite.return404(this);
    }

    res_returnError500_ServerError(error?: any | string): Promise<Response> {
        return this.webSite.return500(this, error);
    }

    res_returnError401_Unauthorized(error?: Error | string): Promise<Response> {
        return this.webSite.return401(this, error);
    }

    res_returnError400_BadRequest(error?: Error | string): Promise<Response> {
        return Promise.resolve(new Response(error ? error.toString() : "Bad request", {status: 400}));
    }

    //endregion

    //region Fetch / Proxy

    proxy_directProxyToServer(): Promise<Response> {
        return (this.webSite as WebSiteImpl).loadBalancer.directProxy(this);
    }

    proxy_proxyRequestTo(server: ServerFetch<any>): Promise<Response> {
        return server.directProxy(this);
    }

    proxy_directProxyWith(server: ServerFetch<any>): Promise<Response> {
        return server.directProxy(this);
    }

    proxy_fetchServer(headers?: Headers, method: string = "GET", url?: URL, body?: RequestBody): Promise<Response> {
        if (!url) url = this.urlInfos;
        return (this.webSite as WebSiteImpl).loadBalancer.fetch(method, url, body, headers);
    }

    //endregion

    //region Cache

    protected _isAddedToCache = false;
    protected _cache_ignoreDefaultBehaviors = false;
    protected _cache_ignoreCacheRead = false;
    protected _cache_ignoreCacheWrite = false;

    /**
     * Allows avoiding the auto-cache default behaviors.
     * The effect depends on when this method is called.
     */
    cache_ignoreDefaultBehaviors() {
        this._cache_ignoreDefaultBehaviors = true;
    }

    /**
     * Allows avoiding getting the value from the cache and bypass it.
     */
    cache_ignoreCacheRead() {
        this._cache_ignoreCacheRead = true;
    }

    /**
     * Allows avoiding writing the value into the cache.
     */
    cache_ignoreCacheWrite() {
        this._cache_ignoreCacheWrite = true;
    }


    /**
     * Get from the cache the entry corresponding to the current url.
     */
    async cache_getFromCache(): Promise<Response | undefined> {
        return await this.cache.getFromCache(this, this.urlInfos);
    }

    async cache_hasInCache(): Promise<boolean> {
        return await this.cache.hasInCache(this.urlInfos);
    }

    cache_removeFromCache(url?: URL): Promise<void> {
        // Avoid double.
        //
        if (!url) {
            url = this.urlInfos;
            url.hostname = url.hostname.toLowerCase();
            url.pathname = url.pathname.toLowerCase();
        }

        return this.cache.removeFromCache(url || this.urlInfos);
    }

    cache_addToCache(response: Response) {
        // Avoid adding two times in the same request.
        // This is required with automatic add functionnality.
        //
        if (this._isAddedToCache) return;
        this._isAddedToCache = false;

        return this.cache.addToCache(this, this.urlInfos, response, (this.webSite as WebSiteImpl).getHeadersToCache());
    }

    /**
     * Allow using a sub-cache.
     * For example, a cache dedicated per user.
     */
    cache_useCache(cache: PageCache) {
        this.cache = cache;
    }

    cache_getSubCache(name: string): PageCache {
        return this.cache.createSubCache(name);
    }

    cache_getCacheEntryIterator(): Iterable<CacheEntry> {
        return this.cache.getCacheEntryIterator();
    }

    //endregion

    //region Test type / React on type

    resValue_getContentTypeOf(response: Response): string | null {
        return response.headers.get("content-type");
    }

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

    resValue_isHtml(response: Response): boolean {
        const contentType = response.headers.get("content-type");
        if (contentType === null) return false;
        return contentType.startsWith("text/html");
    }

    resValue_isCss(response: Response): boolean {
        const contentType = response.headers.get("content-type");
        if (contentType === null) return false;
        return contentType.startsWith("text/css");
    }

    resValue_isJavascript(response: Response): boolean {
        const contentType = response.headers.get("content-type");
        if (contentType === null) return false;
        return contentType.startsWith("application/javascript") || contentType.startsWith("text/javascript");
    }

    resValue_isJson(response: Response): boolean {
        const contentType = response.headers.get("content-type");
        if (contentType === null) return false;
        return contentType.startsWith("application/json");
    }

    resValue_isXFormUrlEncoded(response: Response): boolean {
        const contentType = response.headers.get("content-type");
        if (contentType === null) return false;
        return contentType.startsWith("x-www-form-urlencoded");
    }

    async resValue_hookIfHtml(res: Response, ...hooks: TextModifier[]): Promise<Response> {
        if (this.resValue_isHtml(res)) {
            if (isNodeJS) {
                let headers = new Headers(res.headers);
                headers.delete("content-length");
                headers.delete("content-encoding");

                let newHTML = await this.resValue_applyTextModifiers(res, hooks);
                return new Response(newHTML, {status: res.status, headers});
            }
            else {
                res.headers.delete("content-length");
                res.headers.delete("content-encoding");

                return new Response(
                    await this.resValue_applyTextModifiers(res, hooks),
                    {status: res.status, headers: res.headers}
                );
            }
        }

        return Promise.resolve(res);
    }

    async resValue_hookIfCss(res: Response, ...hooks: TextModifier[]): Promise<Response> {
        if (this.resValue_isCss(res)) {
            return new Response(
                await this.resValue_applyTextModifiers(res, hooks),
                {status: res.status, headers: res.headers}
            );
        }

        return Promise.resolve(res);
    }

    async resValue_hookIfJavascript(res: Response, ...hooks: TextModifier[]): Promise<Response> {
        if (this.resValue_isJavascript(res)) {
            return new Response(
                await this.resValue_applyTextModifiers(res, hooks),
                {status: res.status, headers: res.headers}
            );
        }

        return Promise.resolve(res);
    }

    async resValue_applyTextModifiers(res: Response, hooks: TextModifier[]): Promise<string> {
        let text = await res.text() as string;

        for (const hook of hooks) {
            const hRes = hook(text, this);
            text = hRes instanceof Promise ? await hRes : hRes;
        }

        return text;
    }

    async resValue_executeModifiers(res: Response, hooks: ResponseModifier[]): Promise<Response> {
        for (const hook of hooks) {
            const hRes = hook(res, this);
            res = hRes instanceof Promise ? await hRes : hRes;
        }

        return res;
    }

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

    async tool_duplicateReadableStream(stream: ReadableStream | null): Promise<(ReadableStream<any> | null)[]> {
        if (!stream) return [null, null];
        return stream.tee();
    }

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

    async tool_spyRequest(handleRequest: (req: JopiRequest) => Promise<Response>): Promise<Response> {
        return this.tool_spyRequestData(handleRequest, (data) => {
            this.tool_printSpyRequestData(data);
        });
    }

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
        console.log(headerColor(this.method, this.url));
        console.log(titleColor("|- referer: "), data.reqReferer);
        console.log(titleColor("|- reqContentType:"), data.reqContentType);
        console.log(titleColor("|- reqData:"), data.reqData);
        console.log(titleColor("|- reqCookie:"), data.reqCookies);
        console.log(titleColor("|- resContentType:"), data.resContentType);
        console.log(titleColor("|- resCookieSet:"), data.resCookieSet);
        console.log(titleColor("|- resHeaders:"), data.resHeaders);
        console.log(titleColor("|- resData:"), resAsText);
    }

    async tool_spyRequestData(handleRequest: JopiRouteHandler, onSpy: JopiRequestSpy): Promise<Response> {
        const [bunNewReq, spyReq] = await this.tool_duplicateRawRequest(this.coreRequest);

        // Required because the body is already consumed.
        this.coreRequest = bunNewReq;

        let res = await handleRequest(this);
        const [bunNewRes, spyRes] = await this.tool_duplicateResponse(res);

        // Required because the body is already consumed.
        this.coreRequest = spyReq;

        onSpy({
            method: this.method,
            res: () => spyRes,

            reqUrl: this.url,
            reqReferer: this.headers.get("referer"),
            reqContentType: this.reqContentType,
            reqData: await this.req_getDataInfos(),
            resContentType: res.headers.get("content-type"),
            resContentTypeCat: this.resValue_getContentTypeCategory(res),

            reqCookies: this.headers.get("cookie"),
            resCookieSet: spyRes.headers.getSetCookie(),

            resStatus: spyRes.status,
            resLocation: spyRes.headers.get("location"),
            resHeaders: spyRes.headers
        }, this);

        return bunNewRes;
    }

    tool_filterSearchParams(filter?: SearchParamFilterFunction) {
        if (filter) {
            filter(this.urlInfos);
        } else {
            if (this.routeInfos.searchParamFilter) {
                this.routeInfos.searchParamFilter(this.urlInfos);
            }
        }
    }

    //endregion

    //region Post process

    private postProcess: ((res: Response) => Response)[] | undefined;

    _applyPostProcess(res: Response): Response {
        if (!this.postProcess) return res;
        this.postProcess.forEach(hook => res = hook(res));
        return res;
    }

    //endregion

    //region Cookies

    cookie_reqHasCookie(name: string, value?: string): boolean {
        if (!this.cookies) this.cookies = parseCookies(this.coreRequest.headers);
        if (value) return this.cookies[name] === value;
        return this.cookies[name] !== undefined;
    }

    cookie_getReqCookie(name: string): string | undefined {
        if (!this.cookies) this.cookies = parseCookies(this.coreRequest.headers);
        return this.cookies[name];
    }

    cookie_deleteResCookie(name: string) {
        this.cookie_addCookieToRes(name, "", {maxAge: -1});
    }

    async cookie_hookIfResHasCookie(res: Response, name: string, testCookieValue: null | undefined | TestCookieValue, ...hooks: TextModifier[]): Promise<Response> {
        const cookieValue = this.cookie_getReqCookie(name);

        if (cookieValue) {
            if (testCookieValue && !testCookieValue(cookieValue)) {
                return Promise.resolve(res);
            }

            return this.res_htmlResponse(await this.resValue_applyTextModifiers(res, hooks));
        }

        return Promise.resolve(res);
    }

    cookie_addCookieToRes(cookieName: string, cookieValue: string, options?: CookieOptions) {
        let cookie = `${cookieName}=${cookieValue};`;

        if (options) {
            if (options.maxAge) {
                cookie += ` Max-Age=${options.maxAge};`;
            }
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
     * Allow rendering a document fully formed from a React component.
     */
    react_toResponse(E: ReactNode) {
        return this.res_htmlResponse(ReactServer.renderToStaticMarkup(E));
    }

    react_toString(element: ReactNode): string {
        return ReactServer.renderToStaticMarkup(element);
    }

    private _pageData: PageDataProviderData|undefined;

    /**
     * Return the raw page data for this Request.
     */
    react_getPageData(): PageDataProviderData|undefined {
        return this._pageData;
    }

    /**
     * The new render function.
     * Used while refactoring the renderer.
     * Used while refactoring the renderer.
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
            const options = {
                head: [<link key="jopi.mainBundle" rel="stylesheet" type="text/css" href={bundlePath + pageKey + ".css"} />],
                bodyEnd: [<script key="jopi.mainSript" type="module" src={bundlePath + pageKey + ".js"}></script>]
            };

            const pageDataParams = this.routeInfos.pageDataParams;

            if (pageDataParams) {
                this._pageData = await pageDataParams.provider.getDataForCache({req: this});

                const html = "window['JOPI_PAGE_DATA'] = " + JSON.stringify({
                    d: this._pageData,
                    u: pageDataParams.url
                });

                options.bodyEnd.push(
                    <script type="text/javascript" key="jopi.pageData"
                            dangerouslySetInnerHTML={{__html: html}}></script>
                );
            }

            // Allow faking the environment of the page.
            const controller = new PageController_ExposePrivate<unknown>(
                false,
                (this.webSite as WebSiteImpl).mustRemoveTrailingSlashes,
                options
            );

            controller.setServerRequest(this);
            (this.webSite as WebSiteImpl).executeBrowserInstall(controller);

            const params = this.urlParts;
            const searchParams = this.urlInfos.searchParams;
            let jsonSearchParams: any;

            if (isNodeJS) {
                jsonSearchParams = {};
                searchParams.forEach((v, k) => jsonSearchParams[k] = v);
            } else {
                jsonSearchParams = searchParams.toJSON();
            }

            const html = ReactServer.renderToStaticMarkup(
                <Page controller={controller} >
                    <C params={params} searchParams={jsonSearchParams}/>
                </Page>);

            return new Response(html, {status: 200, headers: {"content-type": "text/html;charset=utf-8"}});
        }
        catch (e: any) {
            console.error(e);
            return await this.res_returnError500_ServerError(e);
        }
    }

    //endregion

    //region JQuery

    jquery_htmlToJquery(html: string) {
        const res = cheerio.load(html);
        initCheerio(res);
        return res;
    }

    //endregion

    //region JWT Tokens

    /**
     * Create a JWT token with the data.
     */
    user_createJwtToken(data: UserInfos): string | undefined {
        return this.userJwtToken = this.webSite.createJwtToken(data);
    }

    /**
     * Extract the JWT token from the Authorization header.
     */
    user_getJwtToken(): string | undefined {
        if (this.userJwtToken) {
            return this.userJwtToken;
        }

        if (this.hasNoUserInfos) {
            return undefined;
        }

        let authHeader = this.headers.get("authorization");

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
     * Try to sign in the user with information you provide.
     * Return true if he is signed in, false otherwise.
     *
     * If signed in, then it automatically adds the Authorization header.
     *
     * @param loginInfo
     *      Information with things like login/password-hash/...
     *      Must match with you have used with webSite.setUserLoginManager.
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

            (this.webSite as WebSiteImpl).storeJwtToken(this);

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
        if (this.isFakingNoUsers) return undefined;

        const token = this.user_getJwtToken();
        if (!token) return undefined;

        return this.webSite.decodeJwtToken(this, token);
    }

    /**
     * Log out the user by deleting his session cookie.
     * Warning: do nothing if the call doesn't come from a browser.
     */
    public user_logOutUser() {
        this.cookie_deleteResCookie("authorization");
    }


    /**
     * Allow faking a state where there is no user connected.
     * Is mainly used by the automatic cache to generate
     * a generic anonymous page.
     */
    public user_fakeNoUsers() {
        this.isFakingNoUsers = true;
    }

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
     * Returns the roles of the user.
     */
    public role_getUserRoles(): string[] {
        const userInfos = this.user_getUserInfos();
        if (!userInfos || !userInfos.roles) return [];
        return userInfos.roles;
    }

    /**
     * Test if the user has at least one of the required roles.
     * @returns
     * - true if the user has at least one of the required roles.
     * - false if the user has none of the required roles.
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
     * Test if the user has at this required role.
     * @returns
     * - true if the user has this required role.
     * - false if not.
     */
    public role_userHasRole(requiredRole: string): boolean {
        const userInfos = this.user_getUserInfos();
        if (!userInfos) return false;

        const userRoles = userInfos.roles;
        if (!userRoles) return false;

        return userRoles.includes(requiredRole);
    }

    /**
     * Test if the user has at least one of the required roles.
     * If not, will directly return a 401 error.
     */
    public role_assertUserHasOneOfThisRoles(requiredRoles: string[]) {
        if (!this.role_userHasOneOfThisRoles(requiredRoles)) {
            throw new SBPE_NotAuthorizedException();
        }
    }

    /**
     * Test if the user has this required role.
     * If not will directly return a 401 error.
     */
    public role_assertUserHasRole(requiredRole: string) {
        if (!this.role_userHasRole(requiredRole)) {
            throw new SBPE_NotAuthorizedException();
        }
    }

    //endregion

    //region File Serving

    async file_returnFile(filePath: string, params?: ReqReturnFileParams): Promise<Response> {
        const res = await this.file_tryReturnFile(filePath, params);
        if (res) return res;

        return this.res_returnError404_NotFound();
    }

    async file_returnRelFile(relFilePath: string, importMeta: {dirname: string}, params?: ReqReturnFileParams): Promise<Response> {
        return this.file_returnFile(jk_fs.join(importMeta.dirname, relFilePath), params);
    }

    async file_tryReturnFile(filePath: string, params?: ReqReturnFileParams): Promise<Response|undefined> {
        let cacheValidationInfos = await this.file_validateCacheHeaders(filePath);

        // Mean that the file doesn't exist.
        if (cacheValidationInfos===undefined) return undefined;

        // Mean that the browser cache is valid. Returns code 304.
        if (cacheValidationInfos instanceof Response) return cacheValidationInfos;

        // Will return the file and add the browser cache headers.
        return (this.webSite as WebSiteImpl).tryReturnFile({
            req: this,
            filePath,
            contentEncoding: params?.contentEncoding,
            validationInfos: cacheValidationInfos
        });
    }

    /**
     * Allow serving a file as a response.
     * Automatically get the file from the url and a root dir.
     */
    async file_serveFromDir(filesRootPath: string, options?: ServeFileOptions): Promise<Response> {
        options = options || gEmptyObject;

        if (options.replaceIndexHtml !== false) {
            if (this.urlInfos.pathname.endsWith("/index.html")) {
                this.urlInfos.pathname = this.urlInfos.pathname.slice(0, -10);
                return this.res_redirect(this.urlInfos, false);
            }

            if (this.urlInfos.pathname.endsWith("/")) {
                this.urlInfos.pathname += "index.html";
            }
        }

        const sfc = new WebSiteMirrorCache(filesRootPath);
        const fromCache = await sfc.getFromCache(this, this.urlInfos);
        if (fromCache) return fromCache;

        if (options.onNotFound) {
            return options.onNotFound(this);
        }

        return this.res_returnError404_NotFound();
    }

    file_calcFileEtag(filePath: string): Promise<string|undefined> {
        return jk_fs.calcFileHash(filePath);
    }

    file_validateCacheHeadersWith(headers: any): Response|undefined {
        let reqEtag = this.headers.get("if-none-match")
        let myEtag = headers["etag"];

        if (reqEtag && (reqEtag===myEtag)) {
            return new Response(null, {
                status: 304,
                headers: {"etag": myEtag}
            });
        }

        let reqLastModifiedSince = this.headers.get("if-modified-since");
        let myLastModifiedSince = headers["if-modified-since"];

        if (myLastModifiedSince && reqLastModifiedSince) {
            const dMyLastModifiedSince = new Date(myLastModifiedSince).getTime();
            const dReqLastModifiedSince = new Date(reqLastModifiedSince).getTime();

            if (dReqLastModifiedSince < dMyLastModifiedSince) {
                return new Response(null, {
                    status: 304,
                    headers: {"last-modified": myLastModifiedSince}
                });
            }
        }
    }

    async file_validateCacheHeaders(filePath: string): Promise<BrowserCacheValidationInfos|Response|undefined> {
        let fileState = await jk_fs.getFileStat(filePath);
        if (!fileState) return undefined;

        let lastModifiedSince = this.headers.get("if-modified-since");

        if (lastModifiedSince) {
            const fileModifiedTime = new Date(fileState.mtimeMs).getTime();
            const clientModifiedTime = new Date(lastModifiedSince).getTime();

            if (fileModifiedTime <= clientModifiedTime) {
                return new Response(null, {
                    status: 304,
                    headers: {"last-modified": new Date(fileState.mtimeMs).toUTCString()}
                });
            }
        }

        let etag = this.headers.get("if-none-match")
        let calcEtag: string|undefined;

        if (etag) {
            calcEtag = await jk_fs.calcFileHash(filePath);

            if (etag === calcEtag) {
                return new Response(null, {
                        status: 304,
                        headers: {"etag": etag}
                });
            }
        }

        if (!calcEtag) calcEtag = await jk_fs.calcFileHash(filePath);
        return {etag: calcEtag!, fileState: fileState!}
    }

    //endregion
}

export class JopiRequestImpl extends JopiRequest {
    public _cache_ignoreDefaultBehaviors = false;
    public _cache_ignoreCacheRead = false;
    public _cache_ignoreCacheWrite = false;
}

export interface JopiRequestSpyData {
    method: string;

    reqUrl: string;
    reqReferer: string | null;
    reqContentType: string | null;
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

export type JopiRequestSpy = (data: JopiRequestSpyData, req: JopiRequest) => void;

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
const gIsSinglePageMode = isSinglePageMode();