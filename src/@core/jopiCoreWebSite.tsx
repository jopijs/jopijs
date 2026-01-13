// noinspection JSUnusedGlobalSymbols

import { JopiRequest, JopiRequestImpl } from "./jopiRequest.tsx";
import { ServerFetch } from "./serverFetch.ts";
import { LoadBalancer } from "./loadBalancing.ts";
import { type CoreServer, type SseEvent, type WebSocketConnectionInfos } from "./jopiServer.ts";
import { PostMiddlewares } from "./middlewares/index.ts";
import jwt from "jsonwebtoken";
import type { SearchParamFilterFunction } from "./searchParamFilter.ts";
import React from "react";
import {
    type MenuItemForExtraPageParams,
    type ExtraPageParams,
    JopiUiApplication,
    type JopiUiApplication_Host,
    PageController,
    type UiUserInfos
} from "jopijs/ui";
import type { PageCache } from "./caches/cache.ts";
import { VoidPageCache } from "./caches/cache.ts";
import { ONE_DAY } from "./publicTools.ts";

import { getInMemoryCache } from "./caches/InMemoryCache.ts";
import { installBundleServer } from "./bundler/index.ts";
import { createBundle } from "./bundler/index.ts";
import * as jk_webSocket from "jopi-toolkit/jk_webSocket";
import type { EventGroup } from "jopi-toolkit/jk_events";
import * as jk_events from "jopi-toolkit/jk_events";
import { installBrowserRefreshSseEvent } from "jopijs/watcher";
import {getWebSiteConfig} from "jopijs/coreconfig";
import { executeBrowserInstall } from "./linker.ts";
import { getNewServerInstanceBuilder, type ServerInstanceBuilder } from "./serverInstanceBuilder.ts";
import { PriorityLevel, sortByPriority, type ValueWithPriority } from "jopi-toolkit/jk_tools";
import { logCache_notInCache, logServer_request } from "./_logs.ts";
import type { TryReturnFileParams } from "./browserCacheControl.ts";
import { installDataSourcesServer, type JopiPageDataProvider } from "./dataSources.ts";

export type RouteHandler = (req: JopiRequest) => Promise<Response>;

export interface MiddlewareOptions {
    /**
     * Defines the execution order of the middleware.
     * Middlewares are executed in descending order of priority (from highest to lowest).
     * - `veryHigh (200)`: Executed first.
     * - `default (0)`: Standard execution.
     * - `veryLow (-200)`: Executed last.
     */
    priority?: PriorityLevel;

    /**
     * Define the path pattern.
     * - "/": matches everything
     * - "/hello": matches "/hello" and sub-paths like "/hello/world" (but NOT "/helloworld")
     * - "/hello/": matches sub-paths like "/hello/world" (but NOT "/hello")
     */
    fromPath?: string;
}

export interface CacheRules {
    /**
     * Define the path pattern.
     * - "/": matches everything
     * - "/hello": matches "/hello" and sub-paths like "/hello/world" (but NOT "/helloworld")
     * - "/hello/": matches sub-paths like "/hello/world" (but NOT "/hello")
     */
    fromPath?: string;

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
     */
    beforeCheckingCache?: (req: JopiRequest) => Promise<Response | undefined | void>;

    /**
     * Define a function which is called when the response is not in the cache.
     */
    ifNotInCache(req: JopiRequest, isPage: boolean): void;
}

/**
 * The core class representing a JopiJS website.
 * Handles routing, middleware, caching, server lifecycle, and more.
 */
export class CoreWebSite {
    readonly port: number;
    readonly host: string;
    readonly welcomeUrl: string;
    readonly isHttps?: boolean = false;
    private http80WebSite?: CoreWebSite;
    certificate?: SslCertificatePath;

    _onRebuildCertificate?: () => void;
    private readonly _onWebSiteReady?: (() => void)[];
    public readonly data: any = {};
    public readonly loadBalancer = new LoadBalancer();
    public readonly events: EventGroup = jk_events.defaultEventGroup;
    public readonly mustRemoveTrailingSlashes: boolean;
    public readonly cookieDefaults?: CookieOptions;

    private globalMiddlewares: Record<string, { value: JopiMiddleware, priority: PriorityLevel, fromPath?: string }[]> = {};
    private globalPostMiddlewares: Record<string, { value: JopiPostMiddleware, priority: PriorityLevel, fromPath?: string }[]> = {};

    /**
     * Creates a new instance of CoreWebSite.
     * @param url The full public URL of the website (e.g. "https://mysite.com:3000").
     * @param options Configuration options for the website.
     */
    constructor(url: string, options?: WebSiteOptions) {
        if (!options) options = {};

        url = url.trim().toLowerCase();

        this.welcomeUrl = url;
        this.certificate = options.certificate;

        const urlInfos = new URL(url);
        this.welcomeUrl = urlInfos.protocol + "//" + urlInfos.hostname;

        if (urlInfos.protocol === "https:") this.isHttps = true;
        else if (urlInfos.protocol !== "http:") throw new Error("invalid url");

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
        this.cookieDefaults = options.cookieDefaults;

        this._onWebSiteReady = options.onWebSiteReady;

        // Allow hooking the newly created websites.
        jk_events.sendEvent("jopi.webSite.created", this);
    }

    /** Returns the public URL of the website. */
    getWelcomeUrl(): string {
        return this.welcomeUrl;
    }

    /**
     * Adds a backend server to the load balancer pool.
     * @param serverFetch The server fetch handler to add.
     * @param weight Priority weight for load balancing (default is equal weight).
     */
    addSourceServer<T>(serverFetch: ServerFetch<T>, weight?: number) {
        this.loadBalancer.addServer<T>(serverFetch, weight);
    }

    /**
     * Returns (or creates) a companion HTTP website that redirects to this HTTPS website.
     * Useful for handling HTTP->HTTPS redirection on port 80.
     */
    getOrCreateHttpRedirectWebsite(): CoreWebSite {
        if (this.http80WebSite) return this.http80WebSite;
        if (this.port === 80) return this;

        let urlInfos = new URL(this.welcomeUrl);
        urlInfos.port = "";
        urlInfos.protocol = "http";

        const webSite = new CoreWebSite(urlInfos.href);
        this.http80WebSite = webSite;

        webSite.onGET("/**", async req => {
            req.req_urlInfos.port = "";
            req.req_urlInfos.protocol = "https";

            return req.res_redirect(req.req_urlInfos.href, true);
        });

        return webSite;
    }

    /**
     * Updates the SSL certificate used by the server.
     * Triggers a certificate rebuild if applicable.
     */
    updateSslCertificate(certificate: SslCertificatePath) {
        this.certificate = certificate;
        if (this._onRebuildCertificate) this._onRebuildCertificate();
    }

    //region Server events

    /** Called internally before the server starts listening. */
    async onBeforeServerStart() {
        await jk_events.sendAsyncEvent("@jopi.server.before.start", { webSite: this });
        await createBundle(this);
        installBundleServer(this);
        installDataSourcesServer(this);

        if (getWebSiteConfig().isBrowserRefreshEnabled) {
            // To known: there is a bug with some Chrome version
            // doing that the SSE event is blocking the browser
            // after 3/4 pages change through a link click
            // (don't occur with a refresh)
            //
            installBrowserRefreshSseEvent(this);
        }
    }

    /** Called internally once the server is successfully started. */
    async onServerStarted() {
        if (this._onWebSiteReady) {
            this._onWebSiteReady.forEach(e => e());
        }

        if (this.welcomeUrl) {
            console.log("Website started:", getWebSiteConfig().webSiteUrl);
        }
    }

    /**
     * Registers a new WebSocket route.
     * @param path The path pattern for the WebSocket.
     * @param handler The handler function for the WebSocket connection.
     */
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

    /**
     * Adds a middleware function that runs before the route handler.
     * @param method The HTTP method to target (or "*" for all).
     * @param middleware The middleware function.
     * @param options Options like priority and path filtering.
     */
    addGlobalMiddleware(method: HttpMethod | "*" | undefined, middleware: JopiMiddleware, options?: MiddlewareOptions) {
        options = options || {};

        let m = method ? method : "*";
        if (!this.globalMiddlewares[m]) this.globalMiddlewares[m] = [];
        this.globalMiddlewares[m].push({ priority: options.priority || PriorityLevel.default, value: middleware, fromPath: options.fromPath });
    }

    /**
     * Adds a post-middleware function that runs after the route handler.
     * @param method The HTTP method to target (or "*" for all).
     * @param middleware The middleware function.
     * @param options Options like priority and path filtering.
     */
    addGlobalPostMiddleware(method: HttpMethod | "*" | undefined, middleware: JopiPostMiddleware, options?: MiddlewareOptions) {
        options = options || {};

        let m = method ? method : "*";
        if (!this.globalPostMiddlewares[m]) this.globalPostMiddlewares[m] = [];
        this.globalPostMiddlewares[m].push({ priority: options.priority || PriorityLevel.default, value: middleware, fromPath: options.fromPath });
    }

    applyMiddlewares(verb: HttpMethod, route: string, handler: JopiRouteHandler, isPage: boolean): JopiRouteHandler {
        function merge<T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
            if (!a) return b;
            if (!b) return a;
            return a.concat(b);
        }

        function mergeMiddlewares(allMiddlewares: JopiMiddleware[]): JopiMiddleware | undefined {
            if (allMiddlewares.length === 0) return undefined;
            if (allMiddlewares.length === 1) return allMiddlewares[0];

            const list = allMiddlewares.reverse();
            let nextToCall: JopiMiddleware | undefined;

            for (let m of list) {
                if (nextToCall) {
                    const toCall = m;
                    const next = nextToCall;

                    nextToCall = async function (req) {
                        let res = toCall(req);
                        if (res instanceof Promise) res = await res;
                        if (res !== null) return res;

                        return next(req);
                    };
                } else {
                    nextToCall = m;
                }
            }

            return nextToCall;
        }

        function mergePostMiddlewares(allMiddlewares: JopiPostMiddleware[]): JopiPostMiddleware | undefined {
            if (allMiddlewares.length === 0) return undefined;
            if (allMiddlewares.length === 1) return allMiddlewares[0];

            const list = allMiddlewares.reverse();
            let nextToCall: JopiPostMiddleware | undefined;

            for (let m of list) {
                if (nextToCall) {
                    const toCall = m;
                    const next = nextToCall;

                    nextToCall = async function (req, res) {
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

        return async (rootReq: JopiRequest) => {
            const routeInfos = (rootReq as JopiRequestImpl).routeInfos;
            const routeRawMiddlewares = routeInfos ? routeInfos.middlewares : undefined;
            const routeRawPostMiddlewares = routeInfos ? routeInfos.postMiddlewares : undefined;

            let globalRawMiddleware = this.globalMiddlewares[verb];
            let globalRawPostMiddleware = this.globalPostMiddlewares[verb];

            if (globalRawMiddleware) {
                globalRawMiddleware = globalRawMiddleware.filter(m => {
                    if (m.fromPath) {
                        if (m.fromPath.endsWith("/")) {
                            if (!route.startsWith(m.fromPath)) return false;
                        } else {
                            if (route !== m.fromPath && !route.startsWith(m.fromPath + "/")) return false;
                        }
                    }

                    return true;
                });
            }

            if (globalRawPostMiddleware) {
                globalRawPostMiddleware = globalRawPostMiddleware.filter(m => {
                    if (m.fromPath) {
                        if (m.fromPath.endsWith("/")) {
                            if (!route.startsWith(m.fromPath)) return false;
                        } else {
                            if (route !== m.fromPath && !route.startsWith(m.fromPath + "/")) return false;
                        }
                    }

                    return true;
                })
            }

            let middlewares = (sortByPriority(merge(routeRawMiddlewares, globalRawMiddleware)) || []).reverse();
            let postMiddlewares = (sortByPriority(merge(routeRawPostMiddlewares, globalRawPostMiddleware)) || []).reverse();

            // **********

            const baseHandler = handler;
            const mustUseAutoCache = this.mustUseAutomaticCache && routeInfos && (routeInfos.mustEnableAutomaticCache === true)
            
            if ((rootReq as JopiRequestImpl).routeInfos.requiredRoles) {
                const roles = (rootReq as JopiRequestImpl).routeInfos.requiredRoles;

                if (roles) {
                    const checkRolesMdw: JopiMiddleware = (localReq: JopiRequest) => {
                        localReq.role_assertUserHasOneOfThisRoles(roles);
                        return null;
                    };

                    middlewares = [checkRolesMdw, ...middlewares];
                }
            }

            if (mustUseAutoCache) {
                const beforeCheckingCache = routeInfos.beforeCheckingCache;
                const afterGetFromCache = routeInfos.afterGetFromCache;
                const beforeAddToCache = rootReq.routeInfos.beforeAddToCache;
                const ifNotInCache = rootReq.routeInfos.ifNotInCache;

                const checkCacheMdw: JopiMiddleware = async function (localReq) {
                    if (beforeCheckingCache) {
                        let r = await beforeCheckingCache(localReq);
                        //
                        if (r) {
                            return fPostMiddleware ? fPostMiddleware(localReq, r) : r;
                        }
                    }

                    if ((localReq as JopiRequestImpl)._cache_ignoreDefaultBehaviors) {
                        (localReq as JopiRequestImpl)._cache_ignoreDefaultBehaviors = false;
                    } else {
                        if (isPage) {
                            // Remove the search params and the href
                            // for security reasons to avoid cache poisoning.
                            //
                            localReq.req_clearSearchParamsAndHash();
                        }
                    }

                    let res: Response | undefined;

                    if (!(localReq as JopiRequestImpl)._cache_ignoreCacheRead) {
                        res = await localReq.cache_getFromCache();

                        if (res) {
                            if (afterGetFromCache) {
                                const r = await afterGetFromCache(localReq, res);
                                //
                                if (r) {
                                    return fPostMiddleware ? fPostMiddleware(localReq, r) : r;
                                }
                            }

                            return fPostMiddleware ? fPostMiddleware(localReq, res) : res;
                        }
                    }

                    logCache_notInCache.info(w => w(`${localReq.req_method} request`, { url: localReq.req_urlInfos?.href }));

                    if (ifNotInCache) {
                        ifNotInCache(localReq, isPage);
                    }

                    if ((localReq as JopiRequestImpl)._cache_ignoreDefaultBehaviors) {
                        (localReq as JopiRequestImpl)._cache_ignoreDefaultBehaviors = false;
                    } else {
                        if (isPage) {
                            // Allows creating anonymous pages.
                            localReq.user_fakeNoUsers();
                        }
                    }

                    // > Here we bypass the default workflow.

                    res = await baseHandler(localReq);

                    if (!(localReq as JopiRequestImpl)._cache_ignoreCacheWrite) {
                        if (beforeAddToCache) {
                            let r = await beforeAddToCache(localReq, res);
                            if (r) return await localReq.cache_addToCache(r)!;
                        } else {
                            return await localReq.cache_addToCache(res)!;
                        }
                    }

                    return res;
                };

                middlewares.push(checkCacheMdw);
            }

            let newHandler: JopiRouteHandler;

            const fMiddleware = mergeMiddlewares(middlewares);
            const fPostMiddleware = mergePostMiddlewares(postMiddlewares);

            if (fMiddleware || fPostMiddleware) {
                newHandler = async (localReq: JopiRequest) => {
                    if (fMiddleware) {
                        const res = await fMiddleware(localReq);
                        if (res) return res;
                    }

                    const res = await baseHandler(localReq);

                    if (fPostMiddleware) {
                        return fPostMiddleware(localReq, res);
                    }

                    return res;
                };
            } else {
                newHandler = handler;
            }

            rootReq.routeInfos.handler = newHandler;
            return await newHandler(rootReq);
        };
    }

    /**
     * Enables CORS (Cross-Origin Resource Sharing) for the website.
     * @param allows A list of allowed origins. If undefined, defaults to the website's own URL.
     */
    enableCors(allows?: string[]) {
        if (!allows) allows = [this.welcomeUrl];
        this.addGlobalPostMiddleware(undefined, PostMiddlewares.cors({ accessControlAllowOrigin: allows }), { priority: PriorityLevel.veryHigh });
    }

    //endregion

    //region Page rendering

    private readonly extraPageParams: ExtraPageParams = {
        menuEntries: []
    }

    /** Returns default parameters used when rendering pages (e.g. menu entries). */
    public getExtraPageParams(): ExtraPageParams {
        return this.extraPageParams;
    }

    /**
     * Add a menu entry which must always be added.
     */
    addMenuEntry(menuEntry: MenuItemForExtraPageParams) {
        this.extraPageParams.menuEntries.push(menuEntry);
    }

    /**
     * Executes the browser-side installation script (hydration code).
     * @param pageController The controller for the current page.
     */
    executeBrowserInstall(pageController: PageController) {
        const modInit = this.createModuleInitInstance(pageController, this.extraPageParams);
        executeBrowserInstall(modInit);
    }

    /**
     * Allow overriding the instance used by modules 'uiInit.tsx' files.
     * @param builder
     */
    setModuleInitClassInstanceBuilder(builder: (host: JopiUiApplication_Host, extraParams: ExtraPageParams) => JopiUiApplication) {
        this.createModuleInitInstance = builder;
    }

    private createModuleInitInstance(pageController: JopiUiApplication_Host, extraParams: any): JopiUiApplication {
        // Note: this function can be replaced.
        return new JopiUiApplication(pageController, extraParams);
    }

    //endregion

    //region Cache

    mainCache: PageCache;
    mustUseAutomaticCache: boolean = true;
    private cacheRules: CacheRules[] = [];
    private headersToCache: string[] = ["content-type", "etag", "last-modified"];

    /** Returns the current cache engine instance. */
    getCache(): PageCache {
        return this.mainCache;
    }

    /**
     * Sets a custom cache engine.
     * @param pageCache The cache implementation to use.
     */
    setCache(pageCache: PageCache) {
        this.mainCache = pageCache || gVoidCache;
    }

    /** Disables the entire automatic caching system. */
    disableAutomaticCache() {
        this.mustUseAutomaticCache = false;
    }

    /** Returns the list of standard headers that are preserved in the cache. */
    getHeadersToCache(): string[] {
        return this.headersToCache;
    }

    /**
     * Adds a header name to the list of headers that should be cached along with the response.
     * @param header The name of the HTTP header.
     */
    addHeaderToCache(header: string) {
        header = header.trim().toLowerCase();
        if (!this.headersToCache.includes(header)) this.headersToCache.push(header);
    }

    /**
     * Sets the global cache rules.
     * @param rules An array of rules to determine caching behavior.
     */
    setCacheRules(rules: CacheRules[]) {
        this.cacheRules = rules;
    }

    private applyCacheRules(routeInfos: WebSiteRouteInfos, path: string) {

        for (let rule of this.cacheRules) {
            if (rule.fromPath) {
                if (rule.fromPath.endsWith("/")) {
                    if (!path.startsWith(rule.fromPath)) continue;
                } else {
                    if (path !== rule.fromPath && !path.startsWith(rule.fromPath + "/")) continue;
                }
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

    /**
     * Stores the JWT token for the current user.
     * Uses the configured token store or falls back to a high-priority cookie.
     */
    public storeJwtToken(req: JopiRequest) {
        const token = req.user_getJwtToken();

        if (this.jwtTokenStore) {
            this.jwtTokenStore(req.user_getJwtToken()!, "jwt " + token, req);
        } else {
            // Note: here we don't set the "Authorization" header, since it's an input-only header.
            // User authorization must stay as long as possible (High priority)
            // in case of browser cookies eviction conflict.
            //
            req.cookie_addCookieToRes("authorization", "jwt " + token, { maxAge: ONE_DAY * 7, priority: "High" });
        }
    }

    /** Sets a custom function to handle how JWT tokens are stored (e.g. in cookies). */
    public setJwtTokenStore(store: JwtTokenStore) {
        this.jwtTokenStore = store;
    }

    /** Creates a signed JWT token containing the user info. */
    createJwtToken(data: UserInfos): string | undefined {
        try {
            return jwt.sign(data as object, this.JWT_SECRET!, this.jwtSignInOptions);
        } catch (e) {
            console.error("createJwtToken", e);
            return undefined;
        }
    }

    /** Decodes and verifies a JWT token. Returns undefined if invalid. */
    decodeJwtToken(req: JopiRequest, token: string): UserInfos | undefined {
        if (!this.JWT_SECRET) return undefined;

        try {
            return jwt.verify(token, this.JWT_SECRET) as UserInfos;
        }
        catch {
            req.user_logOutUser();
            return undefined;
        }
    }

    /** Sets the secret key used for signing JWT tokens. */
    setJwtSecret(secret: string) {
        this.JWT_SECRET = secret;
    }

    /**
     * Attempts to authenticate a user with the provided credentials.
     * Uses the configured auth handler.
     */
    async tryAuthUser<T = LoginPassword>(loginInfo: T): Promise<AuthResult> {
        if (this.authHandler) {
            const res = this.authHandler(loginInfo);
            if (res instanceof Promise) return await res;
            return res;
        }

        return { isOk: false };
    }

    /** Sets the function responsible for validating user credentials. */
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

    /** Retrieves the route configuration for a given method and path. */
    getRouteInfos(verb: string, route: string): WebSiteRouteInfos | undefined {
        return this.allRouteInfos[verb + " " + route];
    }

    /** Tries to serve a static file if it exists. */
    tryReturnFile(params: TryReturnFileParams): Promise<Response | undefined> {
        return this.serverInstanceBuilder.tryReturnFile(params);
    }

    /** Adds a Server-Sent Events (SSE) endpoint. */
    addSseEVent(path: string, handler: SseEvent): void {
        this.serverInstanceBuilder.addSseEVent(path, handler);
    }

    async processRequest(
        handler: RouteHandler | undefined,
        urlParts: any,
        routeInfos: WebSiteRouteInfos | undefined,
        urlInfos: URL | undefined,
        coreRequest: Request,
        coreServer: CoreServer): Promise<Response | undefined>
    {
        // For security reasons. Without that, an attacker can break a cache.
        if (urlInfos) urlInfos.hash = "";

        const req = new JopiRequestImpl(this, urlInfos, coreRequest, coreServer, routeInfos!, urlParts);
        const endReq = logServer_request.beginInfo((w) => w(`${req.req_method} request`, { url: req.req_url }));

        try {
            let res: Response;

            if (handler) {
                res = await handler(req);
                if (!res) {
                    console.warn(`⚠️ Warning, route ${req.routeInfos.route} forget to return a response.`);
                    res = new Response("", { status: 500 });
                }

                res = req._applyPostProcess(res);
            } else {
                res = await req.res_returnError404_NotFound();
            }

            endReq({ status: res.status });
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
                } else if (e instanceof SBPE_ErrorPage) {
                    return await e.apply(this, req);
                }
                else if (e instanceof SBPE_MustReturnWithoutResponseException) {
                    return undefined;
                }
            }

            console.error(e);
            endReq({ error: (e as Error).message });

            return this.return500(req, e as Error | string);
        }
    }

    //region Path handler

    /** Internal helper to register a route handler for a specific HTTP verb. */
    onVerb(verb: HttpMethod, path: string, handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos {
        handler = this.applyMiddlewares(verb, path, handler, false);

        const routeInfos: WebSiteRouteInfos = { route: path, handler };
        this.saveRouteInfos(verb, path, routeInfos);

        this.serverInstanceBuilder.addRoute(verb, path, routeInfos);

        if (verb === "GET") this.applyCacheRules(routeInfos, path);
        return routeInfos;
    }

    /**
     * Registers a page route (renderable React component).
     * @param path The URL path for the page.
     * @param pageKey A unique key for the page.
     * @param reactComponent The React component to render.
     */
    onPage(path: string, pageKey: string, reactComponent: React.FC<any>): WebSiteRouteInfos {
        const routeInfos: WebSiteRouteInfos = { route: path, handler: gVoidRouteHandler };
        this.saveRouteInfos("GET", path, routeInfos);

        this.serverInstanceBuilder.addPage(path, pageKey, reactComponent, routeInfos);

        // Cache is automatically enabled for pages.
        routeInfos.mustEnableAutomaticCache = true;

        return routeInfos;
    }

    /** Registers a GET route handler. */
    onGET(path: string, handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos {
        return this.onVerb("GET", path, handler);
    }

    /** Registers a POST route handler. */
    onPOST(path: string, handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos {
        return this.onVerb("POST", path, handler);
    }

    /** Registers a PUT route handler. */
    onPUT(path: string, handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos {
        return this.onVerb("PUT", path, handler);
    }

    /** Registers a DELETE route handler. */
    onDELETE(path: string, handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos {
        return this.onVerb("DELETE", path, handler);
    }

    /** Registers a PATCH route handler. */
    onPATCH(path: string, handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos {
        return this.onVerb("PATCH", path, handler);
    }

    /** Registers a HEAD route handler. */
    onHEAD(path: string, handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos {
        return this.onVerb("HEAD", path, handler);
    }

    /** Registers a OPTIONS route handler. */
    onOPTIONS(path: string, handler: (req: JopiRequest) => Promise<Response>): WebSiteRouteInfos {
        return this.onVerb("OPTIONS", path, handler);
    }

    //endregion

    //region Error handler

    /** Sets a custom handler for 404 Not Found errors. */
    on404_NotFound(handler: JopiRouteHandler) {
        this._on404_NotFound = handler;
    }

    /** Sets a custom handler for 500 Internal Server Error. */
    on500_Error(handler: JopiRouteHandler) {
        this._on500_Error = handler;
    }

    /** Sets a custom handler for 401 Unauthorized errors. */
    on401_Unauthorized(handler: JopiRouteHandler) {
        this._on401_Unauthorized = handler;
    }

    /** Returns a 404 error response, potentially using a custom handler. */
    async return404(req: JopiRequest): Promise<Response> {
        const accept = req.req_headers.get("accept");
        if (!accept || !accept.startsWith("text/html")) return new Response("", { status: 404 });

        if (this._on404_NotFound) {
            let res = await this._on404_NotFound(req);
            if (res instanceof Promise) res = await res;

            if (res) {
                if (res.status !== 404) {
                    return new Response(res.body, { status: 404, headers: res.headers });
                }

                return res;
            }
        }

        return new Response("", { status: 404 });
    }

    /** Returns a 500 error response, potentially using a custom handler. */
    async return500(req: JopiRequest, error?: any | string): Promise<Response> {
        const accept = req.req_headers.get("accept");
        if (!accept || !accept.startsWith("text/html")) return new Response("", { status: 500 });

        if (this._on500_Error) {
            // Avoid recursions.
            req.res_returnError500_ServerError = async () => {
                return new Response("Internal server error", { status: 500 });
            }

            let res = this._on500_Error(req, error);
            if (res instanceof Promise) res = await res;

            if (res) {
                if (res.status !== 500) {
                    return new Response(res.body, { status: 500, headers: res.headers });
                }

                return res;
            }
        }

        return new Response("", { status: 500 });
    }

    /** Returns a 401 error response, potentially using a custom handler. */
    async return401(req: JopiRequest, error?: Error | string): Promise<Response> {
        if (this._on401_Unauthorized) {
            let res = this._on401_Unauthorized(req, error);
            if (res instanceof Promise) res = await res;

            if (res) {
                if (res.status !== 401) {
                    return new Response(res.body, { status: 401, headers: res.headers });
                }

                return res;
            }
        }

        if (req.req_method !== "GET") {
            return new Response(error ? error.toString() : "", { status: 401 });
        }

        return new Response("", { status: 401 });
    }

    //endregion

    //endregion
}

const gVoidRouteHandler = () => Promise.resolve(new Response("void", { status: 200 }));

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
    onNotFound?: (req: JopiRequest) => Response | Promise<Response>;
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
    onWebSiteReady?: (() => void)[];

    /**
     * If false, will remove the trailing-slash at the end of the urls.
     * The default is true.
     */
    removeTrailingSlash?: boolean;

    /**
     * Default options for cookies.
     */
    cookieDefaults?: CookieOptions;
}

export interface WebSiteRouteInfos {
    route: string;
    handler: JopiRouteHandler;

    middlewares?: ValueWithPriority<JopiMiddleware>[];
    postMiddlewares?: ValueWithPriority<JopiPostMiddleware>[];

    /**
     * If defined, then this is a catch-all slug.
     * Example: for the route /user/[...path] then the slug is "path".
     */
    catchAllSlug?: string;

    /**
     * Data provider for the page.
     */
    pageDataParams?: {
        provider: JopiPageDataProvider;
        roles?: string[];
        url?: string;
    };

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
    beforeCheckingCache?: (req: JopiRequest) => Promise<Response | undefined | void>;

    /**
     * Is executed if the response is not in the cache.
     */
    ifNotInCache?: (req: JopiRequest, isPage: boolean) => void;

    /**
     * Is executed before adding the response to the cache.
     * Returns the response or undefined/void to avoid adding to the cache.
     */
    beforeAddToCache?: (req: JopiRequest, res: Response) => Promise<Response | undefined | void>;

    /**
     * Is executed after getting the response from the cache.
     * Returns the response or undefined/void to avoid using this cache entry.
     */
    afterGetFromCache?: (req: JopiRequest, res: Response) => Promise<Response | undefined | void>;
}

/**
 * Wrapper around the standard WebSocket object to provide JopiJS specific functionality.
 */
export class JopiWebSocket {
    constructor(private readonly webSite: CoreWebSite, private readonly server: CoreServer, private readonly webSocket: WebSocket) {
    }

    /** Closes the WebSocket connection. */
    close(): void {
        this.webSocket.close();
    }

    /** Registers a listener for incoming messages. */
    onMessage(listener: (msg: string | Buffer) => void): void {
        jk_webSocket.onMessage(this.webSocket, listener);
    }

    /** Sends a message to the client. */
    sendMessage(msg: string | Buffer | Uint8Array | ArrayBuffer) {
        jk_webSocket.sendMessage(this.webSocket, msg);
    }
}

/**
 * Factory function to create a new JopiJS website instance.
 * @param url The public URL of the website.
 * @param options Configuration options.
 */
export function newWebSite(url: string, options?: WebSiteOptions): CoreWebSite {
    return new CoreWebSite(url, options);
}

/** Function signature for handling a standard HTTP route. */
export type JopiRouteHandler = (req: JopiRequest) => Promise<Response>;

/** Function signature for handling a WebSocket connection. */
export type JopiWsRouteHandler = (ws: JopiWebSocket, infos: WebSocketConnectionInfos) => void;

/** Function signature for handling HTTP errors (404, 500, etc.). */
export type JopiErrorHandler = (req: JopiRequest, error?: Error | string) => Response | Promise<Response>;

/** Supported HTTP methods. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

/** Represents the incoming request body stream. */
export type RequestBody = ReadableStream<Uint8Array> | null;

/** Represents the body content that can be sent in a response. */
export type SendingBody = ReadableStream<Uint8Array> | string | FormData | null;

/** Function that can modify a response before it is sent. */
export type ResponseModifier = (res: Response, req: JopiRequest) => Response | Promise<Response>;

/** Function that can modify text content (e.g. HTML injection). */
export type TextModifier = (text: string, req: JopiRequest) => string | Promise<string>;

/** Function to validate a cookie value. */
export type TestCookieValue = (value: string) => boolean | Promise<boolean>;

/** 
 * Custom storage handler for JWT tokens.
 * Allows storing tokens in cookies, local storage, or other mechanisms.
 */
export type JwtTokenStore = (jwtToken: string, cookieValue: string, req: JopiRequest) => void;

/**
 * Function (usually a hook) that validates user credentials.
 */
export type UserAuthentificationFunction<T = any> = (loginInfo: T) => AuthResult | Promise<AuthResult>;

/**
 * Middleware function executed before the main route handler.
 * Can return a Response to intercept the request, or null/void to pass to the next handler.
 */
export type JopiMiddleware = (req: JopiRequest) => Response | Promise<Response | null> | null;

/**
 * Middleware function executed after the main route handler.
 * Takes the response generated by the handler and can modify or replace it.
 */
export type JopiPostMiddleware = (req: JopiRequest, res: Response) => Response | Promise<Response>;

/**
 * Base class for exceptions that modify the control flow of the server request processing.
 * These are caught by the server to trigger specific behaviors (redirect, error page, etc.)
 * rather than being treated as standard runtime errors.
 */
export class SBPE_ServerByPassException extends Error {
}

export class SBPE_ErrorPage extends SBPE_ServerByPassException {
    constructor(public readonly code: number) {
        super("error");
    }

    async apply(webSite: CoreWebSite, req: JopiRequest): Promise<Response> {
        try {
            switch (this.code) {
                case 404:
                    return webSite.return404(req);
                case 500:
                    return webSite.return500(req);
                case 401:
                    return webSite.return401(req);
            }
        }
        catch {
        }

        return webSite.return500(req);
    }
}

/**
 * Exception thrown to indicate that the current user does not have the required permissions.
 * Triggers the 401 Unauthorized handler.
 */
export class SBPE_NotAuthorizedException extends SBPE_ServerByPassException {
}

/**
 * Exception thrown to immediately send a specific response, bypassing the rest of the route logic.
 */
export class SBPE_DirectSendThisResponseException extends SBPE_ServerByPassException {
    constructor(public readonly response: Response | JopiRouteHandler) {
        super();
    }
}

/**
 * Exception thrown to stop request processing without sending any response.
 * Useful when the response has already been handled by other means (e.g. raw socket).
 */
export class SBPE_MustReturnWithoutResponseException extends SBPE_ServerByPassException {
    constructor() {
        super();
    }
}

/**
 * Error thrown when attempting to start a server that is already running.
 */
export class ServerAlreadyStartedError extends Error {
    constructor() {
        super("the server is already");
    }
}

/**
 * Options for configuring a cookie.
 * 
 * @example
 * ```typescript
 * req.cookie_addCookieToRes("theme", "dark", {
 *     maxAge: jk_timer.ONE_DAY * 7,
 *     httpOnly: true,
 *     secure: true,
 *     sameSite: "Lax"
 * });
 * ```
 */
export interface CookieOptions {
    /**
     * Number of seconds until the cookie expires. 
     * Takes precedence over `expires`.
     */
    maxAge?: number;

    /**
     * The absolute expiration date for the cookie.
     */
    expires?: Date;

    /**
     * The URL path that must exist in the requested URL for the browser to send the Cookie header.
     * Default is usually the current path.
     */
    path?: string;

    /**
     * The domain that the cookie is valid for.
     */
    domain?: string;

    /**
     * If true, the cookie is only sent to the server when a request is made with the https: scheme.
     */
    secure?: boolean;

    /**
     * If true, prevents client-side scripts from accessing the cookie.
     */
    httpOnly?: boolean;

    /**
     * Controls whether the cookie is sent with cross-site requests.
     * - `Strict`: Sent only in a first-party context.
     * - `Lax`: Sent with safe top-level navigations (default in modern browsers).
     * - `None`: Sent with all requests (requires `Secure` to be true).
     */
    sameSite?: "Strict" | "Lax" | "None";

    /**
     * Suggests a relative priority for cookies with the same name.
     * Used by some browsers (e.g., Chrome) to decide which cookies to evict first
     * when the maximum number of cookies for a domain is reached.
     * 
     * - `Low`: Evicted first.
     * - `Medium`: Default priority.
     * - `High`: Evicted last.
     * 
     * @example
     * // CONFLICT: A website has reached the limit (e.g., 180 cookies).
     * // To add a new cookie, the browser must delete others.
     * 
     * // RESOLUTION:
     * req.cookie_addCookieToRes("important_session", id, { priority: "High" }); // Kept
     * req.cookie_addCookieToRes("non_essential_ux_pref", "val", { priority: "Low" }); // Deleted first
     */
    priority?: "Low" | "Medium" | "High";
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