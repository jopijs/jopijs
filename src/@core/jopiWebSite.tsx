// noinspection JSUnusedGlobalSymbols

import {JopiRequest} from "./jopiRequest.tsx";
import {ServerFetch} from "./serverFetch.ts";
import {LoadBalancer} from "./loadBalancing.ts";
import {type CoreServer, type SseEvent, type WebSocketConnectionInfos} from "./jopiServer.ts";
import {PostMiddlewares} from "./middlewares/index.ts";
import jwt from "jsonwebtoken";
import type {SearchParamFilterFunction} from "./searchParamFilter.ts";
import React from "react";
import {
    type MenuItemForExtraPageParams,
    type ExtraPageParams,
    UiApplication,
    type UiApplication_Host,
    PageController,
    type UiUserInfos
} from "jopijs/ui";
import type {PageCache} from "./caches/cache.ts";
import {VoidPageCache} from "./caches/cache.ts";
import {ONE_DAY} from "./publicTools.ts";

import {getInMemoryCache} from "./caches/InMemoryCache.ts";
import {installBundleServer} from "./bundler/index.ts";
import {createBundle} from "./bundler/index.ts";
import * as jk_webSocket from "jopi-toolkit/jk_webSocket";
import type {EventGroup} from "jopi-toolkit/jk_events";
import * as jk_events from "jopi-toolkit/jk_events";
import {installBrowserRefreshSseEvent, isBrowserRefreshEnabled} from "jopijs/loader-client";
import {executeBrowserInstall} from "./linker.ts";
import {getNewServerInstanceBuilder, type ServerInstanceBuilder} from "./serverInstanceBuilder.ts";
import {PriorityLevel, sortByPriority, type ValueWithPriority} from "jopi-toolkit/jk_tools";
import {logCache_notInCache, logServer_request} from "./_logs.ts";
import type {TryReturnFileParams} from "./browserCacheControl.ts";
import {installDataSourcesServer} from "./dataSources.ts";

export type RouteHandler = (req: JopiRequest) => Promise<Response>;

export interface MiddlewareOptions {
    priority?: PriorityLevel;
    regExp?: RegExp;
}

export interface WebSite {
    data: any;

    getWelcomeUrl(): string;

    getCache(): PageCache;

    setCache(pageCache: PageCache): void;

    disableAutomaticCache(): void;

    onPage(path: string, pageKey: string, reactComponent: React.FC<any>): WebSiteRouteInfos;

    onVerb(verb: HttpMethod, path: string | string[], handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos;

    onGET(path: string | string[], handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos;

    onPOST(path: string | string[], handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos;

    onPUT(path: string | string[], handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos;

    onDELETE(path: string | string[], handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos;

    onPATCH(path: string | string[], handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos;

    onHEAD(path: string | string[], handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos;

    onOPTIONS(path: string | string[], handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos;

    onWebSocketConnect(path: string, handler: JopiWsRouteHandler): void;

    addSseEVent(path: string|string[], handler: SseEvent): void;

    on404_NotFound(handler: JopiRouteHandler): void;
    return404(req: JopiRequest): Promise<Response>;

    on500_Error(handler: JopiRouteHandler): void;
    return500(req: JopiRequest, error?: any | string): Promise<Response>;

    on401_Unauthorized(handler: JopiRouteHandler): void;
    return401(req: JopiRequest, error?: Error | string): Promise<Response>;

    /**
     * Try to authenticate a user.
     *
     * @param loginInfo
     *      Information about the user login/password.
     *      The real type is depending on what you use with the Website.setAuthHandler function.
     */
    tryAuthUser<T = LoginPassword>(loginInfo: T): Promise<AuthResult>;

    /**
     * Set the function which will verify user authentification
     * and returns information about this user once connected.
     */
    setAuthHandler<T>(authHandler: UserAuthentificationFunction<T>): void;

    /**
     * Create a JWT token with the data.
     */
    createJwtToken(data: UserInfos): string | undefined;

    /**
     * Verify and decode the JWT token.
     * Returns the data this token contains, or undefined if the token is invalid.
     */
    decodeJwtToken(req: JopiRequest, token: string): UserInfos | undefined;

    /**
     * Set the secret token for JWT cookies.
     */
    setJwtSecret(secret: string): void;

    /**
     * Allow hooking how the JWT token is stored in the user response.
     */
    setJwtTokenStore(store: JwtTokenStore): void;

    /**
     * If you are using HTTPs, allow creating an HTTP website
     * which will automatically redirect to the HTTP.
     */
    getOrCreateHttpRedirectWebsite(): WebSite;

    /**
     * Ask to update the current SSL certificate.
     * Will allow updating without restarting the server, nor losing connections.
     * Warning: only works with bun.ts, node.ts implementation does nothing.
     */
    updateSslCertificate(certificate: SslCertificatePath): void;

    getHeadersToCache(): string[];

    addHeaderToCache(header: string): void;

    addGlobalMiddleware(method: HttpMethod|"*"|undefined, middleware: JopiMiddleware, options?: MiddlewareOptions): void;
    addGlobalPostMiddleware(method: HttpMethod|"*"|undefined, middleware: JopiPostMiddleware, options?: MiddlewareOptions): void;

    addSourceServer<T>(serverFetch: ServerFetch<T>, weight?: number): void;

    enableCors(allows?: string[]): void;

    readonly events: EventGroup;
}

export interface CacheRules {
    regExp?: RegExp;

    /**
     * If true, then disable the cache for the routes.
     */
    disableAutomaticCache?: boolean;

    /**
     * Define a function which is called when the response is get from the cache.
     * If a value is returned, then this value is used as the new value,
     * allowing to replace what comes from the cache.
     * @param handler
     */
    afterGetFromCache?: (req: JopiRequest, res: Response) => Promise<Response | undefined | void>;

    /**
     * Defines a function which can alter the response to save into the cache or avoid cache adding.
     * If returns a response: this response will be added into the cache.
     * If returns undefined: will not add the response into the cache.
     */
    beforeAddToCache?: (req: JopiRequest, res: Response) => Promise<Response | undefined | void>;

    /**
     * Define a function which is called before checking the cache.
     * This allows doing some checking, and if needed, it can return
     * a response and bypass the request cycle.
     *
     * !! Warning !!
     * You will have to sanitize yourself the url or call manually `req.req_clearSearchParamsAndHash`.
     */
    beforeCheckingCache?: (req: JopiRequest) => Promise<Response | undefined | void>;

    /**
     * Define a function which is called when the response is not in the cache.
     *
     * !! Warning !!
     * Defining this function disables the automatic call to `req.user_fakeNoUsers()`.
     */
    ifNotInCache(req: JopiRequest, isPage: boolean): void;
}

export class WebSiteImpl implements WebSite {
    readonly port: number;
    readonly host: string;
    readonly welcomeUrl: string;
    readonly isHttps?: boolean = false;
    private http80WebSite?: WebSite;
    certificate?: SslCertificatePath;

    _onRebuildCertificate?: () => void;
    private readonly _onWebSiteReady?: (() => void)[];
    public readonly data: any = {};
    public readonly loadBalancer = new LoadBalancer();
    public readonly events: EventGroup = jk_events.defaultEventGroup;
    public readonly mustRemoveTrailingSlashes: boolean;

    private globalMiddlewares: Record<string, {value: JopiMiddleware, priority: PriorityLevel, regExp?: RegExp}[]> = {};
    private globalPostMiddlewares: Record<string, {value: JopiPostMiddleware, priority: PriorityLevel, regExp?: RegExp}[]> = {};
    
    constructor(url: string, options?: WebSiteOptions) {
        if (!options) options = {};

        url = url.trim().toLowerCase();

        this.welcomeUrl = url;
        this.certificate = options.certificate;

        const urlInfos = new URL(url);
        this.welcomeUrl = urlInfos.protocol + "//" + urlInfos.hostname;

        if (urlInfos.protocol === "https:") this.isHttps = true;
        else if (urlInfos.protocol!=="http:") throw new Error("invalid url");

        if (urlInfos.port) {
            this.port = parseInt(urlInfos.port);
            this.welcomeUrl += ':' + this.port;
        } else {
            if (this.isHttps) this.port = 443;
            else this.port = 80;
        }

        this.host = urlInfos.host;
        this.mainCache = options.cache || getInMemoryCache();
        this.serverInstanceBuilder = getNewServerInstanceBuilder(this);
        this.mustRemoveTrailingSlashes = options.removeTrailingSlash !== false;

        this._onWebSiteReady = options.onWebSiteReady;

        // Allow hooking the newly created websites.
        jk_events.sendEvent("jopi.webSite.created", this);
    }

    getWelcomeUrl(): string {
        return this.welcomeUrl;
    }
    
    addSourceServer<T>(serverFetch: ServerFetch<T>, weight?: number) {
        this.loadBalancer.addServer<T>(serverFetch, weight);
    }
    
    getOrCreateHttpRedirectWebsite(): WebSite {
        if (this.http80WebSite) return this.http80WebSite;
        if (this.port===80) return this;

        let urlInfos = new URL(this.welcomeUrl);
        urlInfos.port = "";
        urlInfos.protocol = "http";

        const webSite = new WebSiteImpl(urlInfos.href);
        this.http80WebSite = webSite;

        webSite.onGET("/**", async req => {
            req.urlInfos.port = "";
            req.urlInfos.protocol = "https";

            return req.res_redirectResponse(true, req.urlInfos.href);
        });

        return webSite;
    }

    updateSslCertificate(certificate: SslCertificatePath) {
        this.certificate = certificate;
        if (this._onRebuildCertificate) this._onRebuildCertificate();
    }
    
    //region Server events

    async onBeforeServerStart() {
        await jk_events.sendAsyncEvent("@jopi.server.before.start", {webSite: this});
        await createBundle(this);
        installBundleServer(this);
        installDataSourcesServer(this);

        if (isBrowserRefreshEnabled()) {
            // To known: there is a bug with some Chrome version
            // doing that the SSE event is blocking the browser
            // after 3/4 pages change through a link click
            // (don't occur with a refresh)
            //
            installBrowserRefreshSseEvent(this);
        }
    }

    async onServerStarted() {
        if (this._onWebSiteReady) {
            this._onWebSiteReady.forEach(e => e());
        }

        if (this.welcomeUrl) {
            console.log("Website started:", this.welcomeUrl);
        }
    }

    onWebSocketConnect(path: string, handler: JopiWsRouteHandler) {
        return this.serverInstanceBuilder.addWsRoute(path, handler);
    }

    /*declareNewWebSocketConnection(jws: JopiWebSocket, infos: WebSocketConnectionInfos, urlInfos: URL) {
    const matched = findRoute(this.wsRouter, "ws", urlInfos.pathname);

    if (!matched) {
        jws.close();
        return;
    }

    try { matched.data(jws, infos); }
    catch(e) { console.error(e) }
}*/

    //endregion

    //region Middlewares

    addGlobalMiddleware(method: HttpMethod|"*"|undefined, middleware: JopiMiddleware, options: MiddlewareOptions) {
        options = options || {};

        let m = method ? method : "*";
        if (!this.globalMiddlewares[m]) this.globalMiddlewares[m] = [];
        this.globalMiddlewares[m].push({priority: options.priority||PriorityLevel.default, value: middleware, regExp: options.regExp});
    }

    addGlobalPostMiddleware(method: HttpMethod|"*"|undefined, middleware: JopiPostMiddleware, options: MiddlewareOptions) {
        options = options || {};

        let m = method ? method : "*";
        if (!this.globalPostMiddlewares[m]) this.globalPostMiddlewares[m] = [];
        this.globalPostMiddlewares[m].push({priority: options.priority||PriorityLevel.default, value: middleware, regExp: options.regExp});
    }

    applyMiddlewares(verb: HttpMethod, route: string, handler: JopiRouteHandler, isPage: boolean): JopiRouteHandler {
        function merge<T>(a: T[]|undefined, b: T[]|undefined): T[]|undefined {
            if (!a) return b;
            if (!b) return a;
            return a.concat(b);
        }

        function mergeMiddlewares(allMiddlewares: JopiMiddleware[]): JopiMiddleware|undefined {
            if (allMiddlewares.length===0) return undefined;
            if (allMiddlewares.length===1) return allMiddlewares[0];

            const list = allMiddlewares.reverse();
            let nextToCall: JopiMiddleware|undefined;

            for (let m of list) {
                if (nextToCall) {
                    const toCall = m;
                    const next = nextToCall;

                    nextToCall = async function(req) {
                        let res = toCall(req);
                        if (res instanceof Promise) res = await res;
                        if (res!==null) return res;

                        return next(req);
                    };
                } else {
                    nextToCall = m;
                }
            }

            return nextToCall;
        }

        function mergePostMiddlewares(allMiddlewares: JopiPostMiddleware[]): JopiPostMiddleware|undefined {
            if (allMiddlewares.length===0) return undefined;
            if (allMiddlewares.length===1) return allMiddlewares[0];

            const list = allMiddlewares.reverse();
            let nextToCall: JopiPostMiddleware|undefined;

            for (let m of list) {
                if (nextToCall) {
                    const toCall = m;
                    const next = nextToCall;

                    nextToCall = async function(req, res) {
                        let t = toCall(req, res);
                        if (t instanceof Promise) t = await t;
                        return next(req, t);
                    };
                } else {
                    nextToCall = m;
                }
            }

            return nextToCall;
        }


        return async (req: JopiRequest) => {
            const routeInfos = req.routeInfos;

            const routeRawMiddlewares = routeInfos ? routeInfos.middlewares : undefined;
            const routeRawPostMiddlewares = routeInfos ? routeInfos.postMiddlewares : undefined;

            let globalRawMiddleware = this.globalMiddlewares[verb];
            let globalRawPostMiddleware = this.globalPostMiddlewares[verb];

            if (globalRawMiddleware) {
                globalRawMiddleware = globalRawMiddleware.filter(m => {
                    if (m.regExp) {
                        return m.regExp.test(route);
                    }

                    return true;
                });
            }

            if (globalRawPostMiddleware) {
                globalRawPostMiddleware = globalRawPostMiddleware.filter(m => {
                    if (m.regExp) {
                        return m.regExp.test(route);
                    }

                    return true;
                })
            }

            let middlewares = sortByPriority(merge(routeRawMiddlewares, globalRawMiddleware)) || [];
            let postMiddlewares = sortByPriority(merge(routeRawPostMiddlewares, globalRawPostMiddleware)) || [];

            // **********

            const baseHandler = handler;
            const mustUseAutoCache = this.mustUseAutomaticCache && routeInfos && (routeInfos.mustEnableAutomaticCache === true)
            const extraMiddlewares: JopiMiddleware[] = [];

            if (req.routeInfos.requiredRoles) {
                const roles = req.routeInfos.requiredRoles;

                extraMiddlewares.push((req: JopiRequest) => {
                    req.role_assertUserHasRoles(roles);
                    return null;
                });
            }

            if (mustUseAutoCache) {
                const beforeCheckingCache = routeInfos.beforeCheckingCache;
                const afterGetFromCache = routeInfos.afterGetFromCache;
                const beforeAddToCache = req.routeInfos.beforeAddToCache;
                const ifNotInCache = req.routeInfos.ifNotInCache;

                extraMiddlewares.push(async function () {
                    if (beforeCheckingCache) {
                        let r = await beforeCheckingCache(req);
                        //
                        if (r) {
                            return fPostMiddleware ? fPostMiddleware(req, r) : r;
                        }
                    } else if (isPage) {
                        // Remove the search params and the href
                        // for security reasons to avoid cache poisoning.
                        //
                        req.req_clearSearchParamsAndHash();
                    }

                    let res = await req.cache_getFromCache();

                    if (res) {
                        if (afterGetFromCache) {
                            const r = await afterGetFromCache(req, res);
                            //
                            if (r) {
                                return fPostMiddleware ? fPostMiddleware(req, r) : r;
                            }
                        }

                        return fPostMiddleware ? fPostMiddleware(req, res) : res;
                    }

                    logCache_notInCache.info(w => w(`${req.method} request`, {url: req.urlInfos?.href}));

                    if (ifNotInCache) {
                        ifNotInCache(req, isPage);
                    } else if (isPage) {
                        // Allows creating anonymous pages.
                        req.user_fakeNoUsers();
                    }

                    // > Here we bypass the default workflow.

                    res = await baseHandler(req);

                    if (beforeAddToCache) {
                        let r = await beforeAddToCache(req, res);
                        if (r) return await req.cache_addToCache(r)!;
                    } else {
                        return await req.cache_addToCache(res)!;
                    }

                    return res;
                });
            }

            middlewares = [...extraMiddlewares, ...middlewares];

            let newHandler: JopiRouteHandler;

            const fMiddleware = mergeMiddlewares(middlewares);
            const fPostMiddleware = mergePostMiddlewares(postMiddlewares);

            if (fMiddleware || fPostMiddleware) {
                newHandler = async (req: JopiRequest) => {
                    if (fMiddleware) {
                        const res = await fMiddleware(req);
                        if (res) return res;
                    }

                    const res = await baseHandler(req);

                    if (fPostMiddleware) {
                        return fPostMiddleware(req, res);
                    }

                    return res;
                };
            } else {
                newHandler = handler;
            }

            req.routeInfos.handler = newHandler;
            return await newHandler(req);
        };
    }

    enableCors(allows?: string[]) {
        if (!allows) allows = [this.welcomeUrl];
        this.addGlobalPostMiddleware(undefined, PostMiddlewares.cors({accessControlAllowOrigin: allows}), {priority: PriorityLevel.veryHigh});
    }

    //endregion

    //region Page rendering

    private readonly extraPageParams: ExtraPageParams = {
        menuEntries: []
    }

    public getExtraPageParams(): ExtraPageParams {
        return this.extraPageParams;
    }

    /**
     * Add a menu entry which must always be added.
     */
    addMenuEntry(menuEntry: MenuItemForExtraPageParams) {
        this.extraPageParams.menuEntries.push(menuEntry);
    }

    executeBrowserInstall(pageController: PageController) {
        const modInit = this.createModuleInitInstance(pageController, this.extraPageParams);
        executeBrowserInstall(modInit);
    }

    /**
     * Allow overriding the instance used by modules 'uiInit.tsx' files.
     * @param builder
     */
    setModuleInitClassInstanceBuilder(builder: (host: UiApplication_Host, extraParams: ExtraPageParams) =>  UiApplication) {
        this.createModuleInitInstance = builder;
    }

    private createModuleInitInstance(pageController: UiApplication_Host, extraParams: any): UiApplication {
        // Note: this function can be replaced.
        return new UiApplication(pageController, extraParams);
    }

    //endregion

    //region Cache

    mainCache: PageCache;
    mustUseAutomaticCache: boolean = true;
    private cacheRules: CacheRules[] = [];
    private headersToCache: string[] = ["content-type", "etag", "last-modified"];

    getCache(): PageCache {
        return this.mainCache;
    }

    setCache(pageCache: PageCache) {
        this.mainCache = pageCache || gVoidCache;
    }

    disableAutomaticCache() {
        this.mustUseAutomaticCache = false;
    }

    getHeadersToCache(): string[] {
        return this.headersToCache;
    }

    addHeaderToCache(header: string) {
        header = header.trim().toLowerCase();
        if (!this.headersToCache.includes(header)) this.headersToCache.push(header);
    }

    setCacheRules(rules: CacheRules[]) {
        this.cacheRules = rules;
    }

    private applyCacheRules(routeInfos: WebSiteRouteInfos, path: string) {
        for (let rule of this.cacheRules) {
            if (rule.regExp) {
                if (!rule.regExp.test(path)) continue;
            }

            if (!routeInfos.afterGetFromCache) {
                routeInfos.afterGetFromCache = rule.afterGetFromCache;
            }

            if (!routeInfos.beforeAddToCache) {
                routeInfos.beforeAddToCache = rule.beforeAddToCache;
            }

            if (!routeInfos.beforeCheckingCache) {
                routeInfos.beforeCheckingCache = rule.beforeCheckingCache;
            }

            if (!routeInfos.ifNotInCache) {
                routeInfos.ifNotInCache = rule.ifNotInCache;
            }
        }
    }

    //endregion

    //region JWT Token

    private JWT_SECRET?: string;
    private jwtSignInOptions?: jwt.SignOptions;
    private authHandler?: UserAuthentificationFunction;
    private jwtTokenStore?: JwtTokenStore;

    public storeJwtToken(req: JopiRequest) {
        const token = req.user_getJwtToken();

        if (this.jwtTokenStore) {
            this.jwtTokenStore(req.user_getJwtToken()!, "jwt " + token, req);
        } else {
            // Note: here we don't set the "Authorization" header, since it's an input-only header.
            req.cookie_addCookieToRes("authorization", "jwt " + token, {maxAge: ONE_DAY * 7});
        }
    }

    public setJwtTokenStore(store: JwtTokenStore) {
        this.jwtTokenStore = store;
    }

    createJwtToken(data: UserInfos): string|undefined {
        try {
            return jwt.sign(data as object, this.JWT_SECRET!, this.jwtSignInOptions);
        } catch (e) {
            console.error("createJwtToken", e);
            return undefined;
        }
    }

    decodeJwtToken(req: JopiRequest, token: string): UserInfos|undefined {
        if (!this.JWT_SECRET) return undefined;

        try {
            return jwt.verify(token, this.JWT_SECRET) as UserInfos;
        }
        catch {
            req.user_logOutUser();
            return undefined;
        }
    }

    setJwtSecret(secret: string) {
        this.JWT_SECRET = secret;
    }

    async tryAuthUser<T = LoginPassword>(loginInfo: T): Promise<AuthResult> {
        if (this.authHandler) {
            const res = this.authHandler(loginInfo);
            if (res instanceof Promise) return await res;
            return res;
        }

        return {isOk: false};
    }

    setAuthHandler<T>(authHandler: UserAuthentificationFunction<T>) {
        this.authHandler = authHandler;
    }

    //endregion

    //region Routes processing

    public readonly serverInstanceBuilder: ServerInstanceBuilder;

    private _on404_NotFound?: JopiErrorHandler;
    private _on500_Error?: JopiErrorHandler;
    private _on401_Unauthorized?: JopiErrorHandler;

    private allRouteInfos: Record<string, WebSiteRouteInfos> = {};

    private saveRouteInfos(verb: string, route: string, routeInfos: WebSiteRouteInfos) {
        this.allRouteInfos[verb + " " + route] = routeInfos;
    }

    getRouteInfos(verb: string, route: string): WebSiteRouteInfos|undefined {
        return this.allRouteInfos[verb + " " + route];
    }

    tryReturnFile(params: TryReturnFileParams): Promise<Response|undefined> {
        return this.serverInstanceBuilder.tryReturnFile(params);
    }

    addSseEVent(path: string, handler: SseEvent): void {
        this.serverInstanceBuilder.addSseEVent(path, handler);
    }

    async processRequest(handler: RouteHandler|undefined, urlParts: any, routeInfos: WebSiteRouteInfos|undefined, urlInfos: URL|undefined, coreRequest: Request, coreServer: CoreServer): Promise<Response|undefined> {
        // For security reasons. Without that, an attacker can break a cache.
        if (urlInfos) urlInfos.hash = "";

        const req = new JopiRequest(this, urlInfos, coreRequest, coreServer, routeInfos!);
        req.urlParts = urlParts;

        const endReq = logServer_request.beginInfo((w) => w(`${req.method} request`, {url: req.url }));

        try {
            let res: Response;

            if (handler) {
                res = await handler(req);
                if (!res) {
                    console.warn(`⚠️ Warning, route ${req.routeInfos.route} forget to return a response.`);
                    res = new Response("", {status: 500});
                }

                res = req._applyPostProcess(res);
            } else {
                res = await req.res_returnError404_NotFound();
            }

            endReq({status: res.status});
            return res;
        } catch (e) {
            if (e instanceof SBPE_ServerByPassException) {
                if (e instanceof SBPE_DirectSendThisResponseException) {
                    if (e.response instanceof Response) {
                        return e.response;
                    }
                    else {
                        return await e.response(req);
                    }
                } else if (e instanceof SBPE_NotAuthorizedException) {
                    return req.res_returnError401_Unauthorized();
                } else if (e instanceof SBPE_MustReturnWithoutResponseException) {
                    return undefined;
                }
            }

            console.error(e);
            endReq({error: (e as Error).message});

            return this.return500(req, e as Error | string);
        }
    }

    //region Path handler

    onVerb(verb: HttpMethod, path: string, handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos {
        handler = this.applyMiddlewares(verb, path, handler, false);

        const routeInfos: WebSiteRouteInfos = {route: path, handler};
        this.saveRouteInfos(verb, path, routeInfos);

        this.serverInstanceBuilder.addRoute(verb, path, routeInfos);

        if (verb==="GET") this.applyCacheRules(routeInfos, path);
        return routeInfos;
    }

    onPage(path: string, pageKey: string, reactComponent: React.FC<any>): WebSiteRouteInfos {
        const routeInfos: WebSiteRouteInfos = {route: path, handler: gVoidRouteHandler};
        this.saveRouteInfos("GET", path, routeInfos);

        this.serverInstanceBuilder.addPage(path, pageKey, reactComponent, routeInfos);

        // Cache is automatically enabled for pages.
        routeInfos.mustEnableAutomaticCache = true;

        return routeInfos;
    }

    onGET(path: string, handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos {
        return this.onVerb("GET", path, handler);
    }

    onPOST(path: string, handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos {
        return this.onVerb("POST", path, handler);
    }

    onPUT(path: string, handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos {
        return this.onVerb("PUT", path, handler);
    }

    onDELETE(path: string, handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos {
        return this.onVerb("DELETE", path, handler);
    }

    onPATCH(path: string, handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos {
        return this.onVerb("PATCH", path, handler);
    }

    onHEAD(path: string, handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos {
        return this.onVerb("HEAD", path, handler);
    }

    onOPTIONS(path: string, handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos {
        return this.onVerb("OPTIONS", path, handler);
    }

    //endregion

    //region Error handler

    on404_NotFound(handler: JopiRouteHandler) {
        this._on404_NotFound = handler;
    }

    on500_Error(handler: JopiRouteHandler) {
        this._on500_Error = handler;
    }

    on401_Unauthorized(handler: JopiRouteHandler) {
        this._on401_Unauthorized = handler;
    }

    async return404(req: JopiRequest): Promise<Response> {
        const accept = req.headers.get("accept");
        if (!accept || !accept.startsWith("text/html")) return new Response("", {status: 404});

        if (this._on404_NotFound) {
            let res = await this._on404_NotFound(req);
            if (res instanceof Promise) res = await res;

            if (res) {
                if (res.status !== 404) {
                    return new Response(res.body, {status: 404, headers: res.headers});
                }

                return res;
            }
        }

        return new Response("", {status: 404});
    }

    async return500(req: JopiRequest, error?: any|string): Promise<Response> {
        const accept = req.headers.get("accept");
        if (!accept || !accept.startsWith("text/html")) return new Response("", {status: 500});

        if (this._on500_Error) {
            // Avoid recursions.
            req.res_returnError500_ServerError = async () => {
                return new Response("Internal server error", {status: 500});
            }

            let res = this._on500_Error(req, error);
            if (res instanceof Promise) res = await res;

            if (res) {
                if (res.status !== 500) {
                    return new Response(res.body, {status: 500, headers: res.headers});
                }

                return res;
            }
        }

        return new Response("", {status: 500});
    }

    async return401(req: JopiRequest, error?: Error|string): Promise<Response> {
        if (this._on401_Unauthorized) {
            let res = this._on401_Unauthorized(req, error);
            if (res instanceof Promise) res = await res;

            if (res) {
                if (res.status !== 401) {
                    return new Response(res.body, {status: 401, headers: res.headers});
                }

                return res;
            }
        }

        if (req.method!=="GET") {
            return new Response(error ? error.toString() : "", {status: 401});
        }

        return new Response("", {status: 401});
    }

    //endregion

    //endregion
}

const gVoidRouteHandler = () => Promise.resolve(new Response("void", {status: 200}));

export interface ServeFileOptions {
    /**
     * If true, then /index.html is replaced by / in the browser nav bar.
     * Default is true.
     */
    replaceIndexHtml?: boolean;

    /**
     * If the request file is not found, then call this function.
     * If undefined, then will directly return a 404 error.
     */
    onNotFound?: (req: JopiRequest) => Response|Promise<Response>;
}

export class WebSiteOptions {
    /**
     * The TLS certificate to use;
     */
    certificate?: SslCertificatePath;

    /**
     * Allow defining our own cache for this website and don't use the common one.
     */
    cache?: PageCache;

    /**
     * A list of listeners which must be called when the website is fully operational.
     */
    onWebSiteReady?: (()=>void)[];

    /**
     * If false, will remove the trailing-slash at the end of the urls.
     * The default is true.
     */
    removeTrailingSlash?: boolean;
}

export interface WebSiteRouteInfos {
    route: string;
    handler: JopiRouteHandler;

    middlewares?: ValueWithPriority<JopiMiddleware>[];
    postMiddlewares?: ValueWithPriority<JopiPostMiddleware>[];

    /**
     * A list of roles which are required.
     */
    requiredRoles?: string[];

    /**
     * Define a filter to use to sanitize the search params of the url.
     */
    searchParamFilter?: SearchParamFilterFunction;

    /**
     * If true, the automatic cache is enabled.
     */
    mustEnableAutomaticCache?: boolean;

    /**
     * Is executed before checking the cache.
     * If a response is returned/void, then directly returns this response.
     */
    beforeCheckingCache?: (req: JopiRequest) => Promise<Response|undefined|void>;

    /**
     * Is executed if the response is not in the cache.
     */
    ifNotInCache?: (req: JopiRequest, isPage: boolean) => void;

    /**
     * Is executed before adding the response to the cache.
     * Returns the response or undefined/void to avoid adding to the cache.
     */
    beforeAddToCache?: (req: JopiRequest, res: Response) => Promise<Response|undefined|void>;

    /**
     * Is executed after getting the response from the cache.
     * Returns the response or undefined/void to avoid using this cache entry.
     */
    afterGetFromCache?: (req: JopiRequest, res: Response) => Promise<Response|undefined|void>;
}

export class JopiWebSocket {
    constructor(private readonly webSite: WebSite, private readonly server: CoreServer, private readonly webSocket: WebSocket) {
    }

    close(): void {
        this.webSocket.close();
    }

    onMessage(listener: (msg: string|Buffer) => void): void {
        jk_webSocket.onMessage(this.webSocket, listener);
    }

    sendMessage(msg: string|Buffer|Uint8Array|ArrayBuffer) {
        jk_webSocket.sendMessage(this.webSocket, msg);
    }
}

export function newWebSite(url: string, options?: WebSiteOptions): WebSite {
    return new WebSiteImpl(url, options);
}

export type JopiRouteHandler = (req: JopiRequest) => Promise<Response>;
export type JopiWsRouteHandler = (ws: JopiWebSocket, infos: WebSocketConnectionInfos) => void;
export type JopiErrorHandler = (req: JopiRequest, error?: Error|string) => Response|Promise<Response>;
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
export type RequestBody = ReadableStream<Uint8Array> | null;
export type SendingBody = ReadableStream<Uint8Array> | string | FormData | null;

export type ResponseModifier = (res: Response, req: JopiRequest) => Response|Promise<Response>;
export type TextModifier = (text: string, req: JopiRequest) => string|Promise<string>;
export type TestCookieValue = (value: string) => boolean|Promise<boolean>;

export type JwtTokenStore = (jwtToken: string, cookieValue: string, req: JopiRequest) => void;
export type UserAuthentificationFunction<T = any> = (loginInfo: T) => AuthResult|Promise<AuthResult>;

export type JopiMiddleware = (req: JopiRequest) => Response | Promise<Response|null> | null;
export type JopiPostMiddleware = (req: JopiRequest, res: Response) => Response | Promise<Response>;

export class SBPE_ServerByPassException extends Error {
}

export class SBPE_NotAuthorizedException extends SBPE_ServerByPassException {
}

export class SBPE_DirectSendThisResponseException extends SBPE_ServerByPassException {
    constructor(public readonly response: Response| JopiRouteHandler) {
        super();
    }
}

export class SBPE_MustReturnWithoutResponseException extends SBPE_ServerByPassException {
    constructor() {
        super();
    }
}

export class ServerAlreadyStartedError extends Error {
    constructor() {
        super("the server is already");
    }
}

export interface CookieOptions {
    maxAge?: number;
}

export interface UserInfos extends UiUserInfos {
}

export interface AuthResult {
    isOk: boolean;
    errorMessage?: string;
    authToken?: string;
    userInfos?: UserInfos;
}

export interface SslCertificatePath {
    key: string;
    cert: string;
}

export interface LoginPassword {
    login: string;
    password: string;
}

const gVoidCache = new VoidPageCache();