// noinspection JSUnusedGlobalSymbols

import path from "node:path";
import fsc from "node:fs";
import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_timer from "jopi-toolkit/jk_timer";
import * as jk_term from "jopi-toolkit/jk_term";
import * as jk_events from "jopi-toolkit/jk_events";
import {WebSiteCrawler, type WebSiteCrawlerOptions} from "jopijs/crawler";

import { type FetchOptions, type ServerDownResult, ServerFetch, type ServerFetchOptions } from "./serverFetch.ts";
import { getLetsEncryptCertificate, type LetsEncryptParams, type OnTimeoutError } from "./letsEncrypt.ts";
import { type UserInfos_WithLoginPassword, UserStore_WithLoginPassword } from "./userStores.ts";
import { getBundlerConfig, type PostCssInitializer } from "./bundler/index.ts";
import { getInMemoryCache, initMemoryCache, type InMemoryCacheOptions } from "./cacheHtml/InMemoryCache.ts";
import { SimpleFileCache } from "./cacheHtml/SimpleFileCache.ts";
import { type PageCache, VoidPageCache } from "./cacheHtml/cache.ts";
import type { ObjectCache } from "./cacheObject/def.ts";
import {
    getInMemoryObjectCache,
    initMemoryObjectCache,
    type InMemoryObjectCacheOptions
} from "./cacheObject/inMemoryObjectCache.ts";
import { FileObjectCache } from "./cacheObject/fileObjectCache.ts";
import { JopiRequest } from "./jopiRequest.ts";

import {
    type CacheRules,
    type HttpMethod,
    type JopiMiddleware,
    type JopiPostMiddleware,
    type MiddlewareOptions,
    type UserAuthentificationFunction,
    type UserInfos,
    CoreWebSite,
    WebSiteOptions,
    type CookieOptions
} from "./jopiCoreWebSite.ts";

import { getServer, type SseEvent } from "./jopiServer.ts";
import { initLinker } from "./linker.ts";
import { addStaticEvent_ui, addStaticEvent_server } from "jopijs/linker";
import { logServer_startApp } from "./_logs.ts";
import type { LoggerGroupCallback } from "jopi-toolkit/jk_logs";
import { setHttpProxyReadPause } from "./dataSources.ts";
import { isDevelopment } from "jopi-toolkit/jk_process";
import { getWebSiteConfig } from "jopijs/coreconfig";
import { initProcessSupervisor } from "./watcher.ts";

/**
 * The main application class for JopiJS.
 * Responsible for initializing the environment and starting the web server.
 */
class JopiApp {
    private _isStartAppSet: boolean = false;

    /**
     * Initializes and starts the JopiJS application.
     * 
     * @param importMeta The `import.meta` of the main application file.
     * @param f A configuration function that receives a `JopiWebSiteBuilder`.
     * @throws {Error} if called more than once.
     * 
     * @example
     * ```ts
     * jopiApp.startApp(import.meta, (app) => {
     *   app.add_specialPageHandler().on_404_NotFound(req => req.res_textResponse("Oops!", 404));
     * });
     * ```
     */
    startApp(importMeta: any, f?: (webSite: JopiWebSiteBuilder) => void | Promise<void>): void {
        jk_app.setApplicationMainFile(importMeta.filename);
        const ssgEnv = getSsgEnvValue();

        // The supervisor process is the one that will watch for changes.
        // It spawn the app process, and restart on change.
        //
        // Here we also have SSG mode (static site generation).
        // When SSG, it only spawn the app process, no watching.
        //
        if (initProcessSupervisor(!!ssgEnv)) {
            // If supervisor, then do nothing.
            // The application will not exit du to the watching process.

            return;
        }
        
        if (ssgEnv) {
            // Here we are inside the supervisor process.
            //
            const doStart = async () => {
                const url = this.getDefaultUrl();

                // Create the web site builder object.
                // But without automatic starting of the server.
                //
                const webSite = new WebSite_ExposePrivate(url, false);

                // Initialize the web site.
                // Here only the crawler config will interest us.
                //
                if (f) {
                    let res = f(webSite);
                    if (res instanceof Promise) await res;
                }

                executeCrawler();
            }

            doStart().then();
        } else {
            const doStart = async () => {
                const url = this.getDefaultUrl();
                const webSite = new WebSite_ExposePrivate(url);

                if (f) {
                    let res = f(webSite);
                    if (res instanceof Promise) await res;
                }
            }

            if (this._isStartAppSet) throw "App is already started";
            this._isStartAppSet = true;

            doStart().then();
        }
    }

    private getDefaultUrl(): string {
        let config = getWebSiteConfig();

        if (config.webSiteListeningUrl) return config.webSiteListeningUrl;
        if (config.webSiteUrl) return config.webSiteUrl;

        throw new Error("Invalid package.json configuration. 'jopi.webSiteUrl' or 'jopi.webSiteListeningUrl' must be set");
    }
}

let gMetricsOnWebsiteStarted: LoggerGroupCallback = logServer_startApp.beginInfo("Starting Application");

/**
 * Singleton instance of the JopiJS Application.
 */
export const jopiApp = new JopiApp();

//region CreateServerFetch

/**
 * Fluent builder for creating internal server-to-server fetch configurations.
 * Used for load-balancing and proxying to backend data sources.
 */
class CreateServerFetch<T, R extends CreateServerFetch_NextStep<T>> {
    protected options?: ServerFetchOptions<T>;

    protected createNextStep(options: ServerFetchOptions<T>): R {
        return new CreateServerFetch_NextStep(options) as R;
    }

    /**
     * Resolves the server by his IP address but sets the correct Host header.
     * Essential when DNS isn't pointing to the target server yet or for internal networking.
     * 
     * @param serverOrigin The targeted public origin (e.g., https://myserver.com).
     * @param ip The real IP address or internal hostname to connect to.
     * @param options Additional fetch configuration.
     */
    useIp(serverOrigin: string, ip: string, options?: ServerFetchOptions<T>): R {
        let rOptions = ServerFetch.getOptionsFor_useIP<T>(serverOrigin, ip, options);
        this.options = rOptions;
        return this.createNextStep(rOptions);
    }

    /**
     * Connects to the server using its standard public hostname.
     * @param serverOrigin The public origin of the server.
     * @param options Additional fetch configuration.
     */
    useOrigin(serverOrigin: string, options?: ServerFetchOptions<T>): R {
        let rOptions = ServerFetch.getOptionsFor_useOrigin<T>(serverOrigin, options);
        this.options = rOptions;
        return this.createNextStep(rOptions);
    }
}

class CreateServerFetch_NextStep<T> {
    constructor(protected options: ServerFetchOptions<T>) {
    }

    /**
     * Sets the priority weight of this server in the load-balancer.
     * - 1 (default): Standard active server.
     * - > 1: Increases priority/traffic share.
     * - 0: Backup server (only used if other servers are down).
     */
    set_weight(weight: number): this {
        this.options.weight = weight;
        return this;
    }

    set_isMainServer(): this {
        return this.set_weight(1);
    }

    set_isBackupServer(): this {
        return this.set_weight(0);
    }

    /** Registers a hook called before the fetch request is sent. */
    on_beforeRequesting(handler: (url: string, fetchOptions: FetchOptions, data: T) => void | Promise<void>): this {
        this.options.beforeRequesting = handler;
        return this;
    }

    /** Registers a failover handler if the server is unresponsive. */
    on_ifServerIsDown(handler: (builder: IfServerDownBuilder<T>) => void | Promise<void>): this {
        this.options.ifServerIsDown = async (_fetcher, data) => {
            const { builder, getResult } = IfServerDownBuilder.newBuilder<T>(data);

            let r = handler(builder);
            if (r instanceof Promise) await r;

            let options = getResult();

            if (options) {
                const res: ServerDownResult<T> = {
                    newServer: ServerFetch.useAsIs(options),
                    newServerWeight: options?.weight
                }

                return res;
            }

            return undefined;
        }

        return this;
    }

    do_startServer(handler: () => Promise<number>): this {
        this.options.doStartServer = handler;
        return this;
    }

    do_stopServer(handler: () => Promise<void>): this {
        this.options.doStopServer = handler;
        return this;
    }
}

class IfServerDownBuilder<T> extends CreateServerFetch<T, CreateServerFetch_NextStep<T>> {
    constructor(public readonly data: T) {
        super();
    }

    static newBuilder<T>(data: T) {
        const b = new IfServerDownBuilder<T>(data);
        return { builder: b, getResult: () => b.options };
    }
}

//endregion

//region WebSite

let gCrawlerInstance: WebSite_CrawlerBuilder | undefined;

/**
 * Options for the default internal static file server.
 */
export interface FileServerOptions {
    /** Root directory relative to the project (default: "public"). */
    rootDir: string;
    /** Whether to automatically serve index.html for directory requests (default: true). */
    replaceIndexHtml: boolean,
    /** Custom handler when a file is not found. */
    onNotFound: (req: JopiRequest) => Response | Promise<Response>
}

/**
 * Main logic for configuring a JopiJS website.
 * Follows a fluent/builder pattern to setup caching, security, auth, and data sources.
 */
export class JopiWebSiteBuilder {
    protected readonly origin: string;
    protected readonly hostName: string;
    private webSite?: CoreWebSite;
    protected readonly options: WebSiteOptions = {};

    protected readonly afterHook: ((webSite: CoreWebSite) => (Promise<void>))[] = [];
    protected readonly beforeHook: (() => Promise<void>)[] = [];

    protected readonly internals: WebSiteInternal;
    protected _isWebSiteReady: boolean = false;

    protected fileServerOptions: FileServerOptions;

    public readonly events = jk_events.defaultEventGroup;

    constructor(url: string, autoStart: boolean = true) {
        if (autoStart) {
            setTimeout(async () => {
                await this.initWebSiteInstance();
            }, 1);
        }

        const urlInfos = new URL(url);
        this.hostName = urlInfos.hostname; // 127.0.0.1
        this.origin = urlInfos.origin; // https://127.0.0.1

        this.internals = {
            options: this.options,
            origin: this.origin,
            hostName: this.hostName,
            afterHook: this.afterHook,
            beforeHook: this.beforeHook
        };

        this.options.onWebSiteReady = [() => {
            this._isWebSiteReady = true;
        }];

        if (this.origin.startsWith("https://")) {
            this.internals.beforeHook.push(async () => {
                if (!gIsSslCertificateDefined) {
                    this.internals.options.certificate = useCertificateStore("certs", this.hostName);
                }
            })
        }

        this.fileServerOptions = {
            rootDir: "public",
            replaceIndexHtml: true,
            onNotFound: req => req.res_returnError404_NotFound()
        };

        this.internals.afterHook.push(async webSite => {
            webSite.onGET("/**", req => {
                return req.file_serveFromDir(this.fileServerOptions.rootDir, {
                    replaceIndexHtml: this.fileServerOptions.replaceIndexHtml,
                    onNotFound: this.fileServerOptions.onNotFound
                });
            });
        });

        // Will allow `import eventUserInfosUpdated from "@/events/app.user.infosUpdated"`
        this.add_staticEvent_ui("app.user.infosUpdated");
        this.add_staticEvent_ui("app.menu.click");
        this.add_staticEvent_ui("app.menu.invalided");
        this.add_staticEvent_ui("app.menu.activeItemChanged");
    }

    private async initWebSiteInstance(): Promise<void> {
        const onWebSiteCreate = (h: (webSite: CoreWebSite) => void | Promise<void>) => {
            this.internals.afterHook.push(h);
        }

        if (!this.webSite) {
            await initLinker(this, onWebSiteCreate);

            for (let hook of this.beforeHook) await hook();

            if (getSsgEnvValueRaw() !== undefined) {
                // This disable the cache, and also the automatic compression.
                // It's needed because of a Node.js (v22) issue with fetch + compression. 
                this.options.cache = new VoidPageCache();
            }

            this.webSite = new CoreWebSite(this.origin, this.options);

            for (const hook of this.afterHook) {
                try {
                    await hook(this.webSite!);
                }
                catch (e: any) {
                    if (e instanceof Error) {
                        jk_term.logBgRed("Error when initializing website", this.origin);
                        jk_term.logRed(e.message);
                        console.log(e.stack);
                    }
                    else {
                        console.error("Error when initializing website", this.origin);
                        jk_term.logRed("|-", e.message);
                    }

                    process.exit(1);
                }
            }

            if (!giIsCorsDisabled) {
                this.webSite.enableCors([this.webSite.welcomeUrl, ...gCorsConstraints]);
            }

            myServer.setWebsite(this.webSite);
            await autoStartServer();
        }

        if (this.internals.onHookWebSite) {
            this.internals.onHookWebSite(this.webSite);
        }

        if (gMetricsOnWebsiteStarted) {
            gMetricsOnWebsiteStarted();
        }
    }

    /** Registers a callback hook to customize the `CoreWebSite` instance directly. */
    hook_webSite(hook: (webSite: CoreWebSite) => void): this {
        this.internals.onHookWebSite = hook;
        return this;
    }

    /** Ends the website configuration and returns the main application instance. */
    DONE_createWebSite(): JopiApp {
        return jopiApp;
    }

    /** Configures TLS/SSL certificates for HTTPS. */
    add_httpCertificate(): CertificateBuilder {
        return new CertificateBuilder(this, this.internals);
    }

    /** 
     * Quickly configures the static file server.
     * @param options Configuration options.
     */
    fastConfigure_fileServer(options: FileServerOptions): JopiWebSiteBuilder {
        this.fileServerOptions = options;
        return this;
    }

    /** Starts the fluent configuration for the static file server. */
    configure_fileServer() {
        const parent = this;

        const me = {
            /** Sets the root directory for static files. */
            set_rootDir: (rootDir: string) => {
                this.fileServerOptions.rootDir = rootDir;
                return me;
            },

            /** Sets the 404 handler for missing files. */
            set_onNotFound: (handler: (req: JopiRequest) => Response | Promise<Response>) => {
                this.fileServerOptions.onNotFound = handler;
                return me;
            },

            /** Completes the file server configuration. */
            DONE_configure_fileServer: (): JopiWebSiteBuilder => {
                return parent;
            }
        };

        return me;
    }

    /** Starts the fluent configuration for JWT authentication. */
    configure_jwtTokenAuth(): JWT_BEGIN {
        const builder = new JwtTokenAuth_Builder(this, this.internals);

        return {
            step_setPrivateKey: (privateKey: string) => builder.setPrivateKey_STEP(privateKey)
        }
    }

    /** 
     * Quickly configures JWT authentication with a simple user store or custom handler.
     * @param privateKey The secret key used for signing tokens.
     * @param store Either an array of hardcoded users or a custom authentication function.
     */
    fastConfigure_jwtTokenAuth<T>(privateKey: string, store: any[] | UserAuthentificationFunction<T>): JopiWebSiteBuilder {
        const builder = new JwtTokenAuth_Builder(this, this.internals);
        let config = builder.setPrivateKey_STEP(privateKey).step_setUserStore();

        if (store instanceof Array) {
            config.use_simpleLoginPassword().addMany(store)
        }
        else {
            config.use_customStore(store);
        }

        return this;
    }

    /** 
     * Adds a Server-Sent Events (SSE) endpoint to the website.
     * @param path The URL path for the SSE endpoint.
     * @param handler The SSE logic handler.
     */
    add_SseEvent(path: string, handler: SseEvent): JopiWebSiteBuilder {
        this.internals.afterHook.push((webSite) => {
            webSite.addSseEVent(path, handler);
        });

        return this;
    }

    /**
     * Registers a static event name.
     */
    add_staticEvent_ui(name: string): JopiWebSiteBuilder {
        addStaticEvent_ui(name);
        return this;
    }

    /**
     * Registers a static server event name.
     */
    add_staticEvent_server(name: string): JopiWebSiteBuilder {
        addStaticEvent_server(name);
        return this;
    }

    /** Fluent configuration for PostCSS and CSS bundling. */
    configure_postCss() {
        const parent: JopiWebSiteBuilder = this;

        const me = {
            /** Custom initializer for PostCSS plugins. */
            setPlugin: (handler: PostCssInitializer) => {
                getBundlerConfig().postCss.initializer = handler;
                return me;
            },

            END_configure_postCss() {
                return parent;
            }
        };

        return me;
    }

    /** Fluent configuration for global website behaviors. */
    configure_behaviors(): WebSite_ConfigureBehaviors {
        const parent: JopiWebSiteBuilder = this;

        const me: WebSite_ConfigureBehaviors = {
            /** 
             * If true, keeps trailing slashes in URLs. 
             * By default, JopiJS removes them for canonicalization.
             */
            enableTrailingSlashes(value: boolean = true) {
                parent.options.removeTrailingSlash = !value;
                return me;
            },

            /** 
             * Defines default options for all cookies created on the server side. 
             * These defaults are merged with specific options passed to `cookie_addCookieToRes`.
             */
            setCookieDefaults(options: CookieOptions) {
                parent.options.cookieDefaults = options;
                return me;
            },

            DONE_configure_behaviors(): JopiWebSiteBuilder {
                return parent;
            }
        }

        return me;
    }

    /** Fluent configuration for development-only behaviors. */
    configure_devBehaviors(): WebSite_ConfigureDevBehaviors {
        const parent: JopiWebSiteBuilder = this;

        const me: WebSite_ConfigureDevBehaviors = {
            /** 
             * Simulates network latency for DataSource requests.
             * Useful for testing loading states in the UI.
             */
            slowDownHttpDataSources(pauseMs: number) {
                if (isDevelopment) {
                    setHttpProxyReadPause(pauseMs);
                }
                return me;
            },

            DONE_configure_devBehaviors(): JopiWebSiteBuilder {
                return parent;
            }
        }

        return me;
    }

    /** Configuration for the page/API cache engine. */
    configure_htmlCache(): WebSite_HtmlCacheBuilder {
        return new WebSite_HtmlCacheBuilder(this, this.internals);
    }

    /** Configuration for the object cache engine. */
    configure_objectCache(): WebSite_ObjectCacheBuilder {
        return new WebSite_ObjectCacheBuilder(this, this.internals);
    }


    /** Configuration for global middlewares (hooks executed on every request). */
    configure_middlewares(): WebSite_MiddlewareBuilder {
        return new WebSite_MiddlewareBuilder(this, this.internals);
    }

    /** Configuration for the client-side bundler (Vite). */
    configure_bundler() {
        const parent: JopiWebSiteBuilder = this;

        const me = {
            /** Optimization: Tells the bundler to not embed React and React-Dom in the bundle (assuming they are provided globally or via CDN). */
            dontEmbed_ReactJS: () => {
                me.dontEmbedThis("react", "react-dom");
                return me;
            },

            /** Optimization: Prevents specific packages from being bundled into the client scripts. */
            dontEmbedThis: (...packages: string[]) => {
                let config = getBundlerConfig();
                if (!config.embed.dontEmbedThis) config.embed.dontEmbedThis = [];
                config.embed.dontEmbedThis.push(...packages);
                return me;
            },

            END_configure_bundler(): JopiWebSiteBuilder {
                return parent;
            }
        }

        return me;
    }

    /** Configuration for the Tailwind CSS processor. */
    configure_tailwindProcessor() {
        const parent: JopiWebSiteBuilder = this;

        const me = {
            /** Completely disables Tailwind CSS processing. */
            disableTailwind: () => {
                getBundlerConfig().tailwind.disable = true;
                return me;
            },

            END_configure_tailwindProcessor(): JopiWebSiteBuilder {
                return parent;
            }
        }

        return me;
    }

    /** Registers a backend server source (for load-balancing or proxying). */
    add_sourceServer<T>(): WebSite_AddSourceServerBuilder<T> {
        return new WebSite_AddSourceServerBuilder<T>(this, this.internals);
    }

    /** Registers custom handlers for standard HTTP error pages (404, 500, etc.). */
    add_specialPageHandler(): WebSite_AddSpecialPageHandler {
        return new WebSite_AddSpecialPageHandler(this, this.internals);
    }

    /** Executes a listener once the website instance is fully initialized. */
    on_webSiteReady(listener: () => void) {
        if (this._isWebSiteReady) {
            listener();
            return;
        }

        this.options.onWebSiteReady!.push(listener);
        return this;
    }

    /** Configuration for Cross-Origin Resource Sharing (CORS). */
    configure_cors() {
        return new WebSite_ConfigureCors(this);
    }

    /** 
     * Quickly configures CORS for specific hostnames.
     * @param allowedHosts List of allowed origins (e.g. ["https://myfrontend.com"]).
     */
    fastConfigure_cors(allowedHosts?: string[]): JopiWebSiteBuilder {
        const b = new WebSite_ConfigureCors(this);

        if (allowedHosts) {
            allowedHosts.forEach(o => b.add_allowedHost(o));
        }

        return this;
    }

    /**
     * Configuration for the satic-site generator (SSG crawler).
     */
    configure_crawler(): WebSite_CrawlerBuilder {
        if (gCrawlerInstance) return gCrawlerInstance;
        gCrawlerInstance = new WebSite_CrawlerBuilder(this);
        return gCrawlerInstance;
    }
}

interface WebSiteInternal {
    origin: string;
    hostName: string;
    options: WebSiteOptions;

    afterHook: ((webSite: CoreWebSite) => void | Promise<void>)[];
    beforeHook: (() => Promise<void>)[];

    onHookWebSite?: (webSite: CoreWebSite) => void;
}

class WebSite_ExposePrivate extends JopiWebSiteBuilder {
    isWebSiteReady() {
        return this._isWebSiteReady;
    }

    getInternals(): WebSiteInternal {
        return this.internals;
    }
}

/** Configuration builder for CORS policies. */
class WebSite_ConfigureCors {
    constructor(private readonly webSite: JopiWebSiteBuilder) {
    }

    /** 
     * Whitelists a specific hostname for cross-origin requests.
     * @param hostName The URL string (e.g. https://domain.com).
     */
    add_allowedHost(hostName: string) {
        try {
            let url = new URL(hostName);
            gCorsConstraints.push(url.origin);
        }
        catch {
            throw new Error(`Invalid host name: ${hostName}. Must be a valid URL.`);
        }

        return this;
    }

    /** Completely disables CORS protection (allows all origins). */
    disable_cors() {
        giIsCorsDisabled = true;
        return this;
    }

    DONE_configure_cors(): JopiWebSiteBuilder {
        return this.webSite;
    }
}

/** Configuration builder for standard HTTP error handlers. */
class WebSite_AddSpecialPageHandler {
    constructor(private readonly webSite: JopiWebSiteBuilder, private readonly internals: WebSiteInternal) {
    }

    END_add_specialPageHandler(): JopiWebSiteBuilder {
        return this.webSite;
    }

    /** Custom handler for 404 Not Found errors. */
    on_404_NotFound(handler: (req: JopiRequest) => Promise<Response>): this {
        this.internals.afterHook.push(async webSite => {
            webSite.on404_NotFound(handler);
        });

        return this;
    }

    /** Custom handler for 500 Internal Server Errors. */
    on_500_Error(handler: (req: JopiRequest) => Promise<Response>): this {
        this.internals.afterHook.push(async webSite => {
            webSite.on500_Error(handler);
        });

        return this;
    }

    /** Custom handler for 401 Unauthorized errors. */
    on_401_Unauthorized(handler: (req: JopiRequest) => Promise<Response>): this {
        this.internals.afterHook.push(async webSite => {
            webSite.on401_Unauthorized(handler);
        });

        return this;
    }
}

class WebSite_AddSourceServerBuilder<T> extends CreateServerFetch<T, WebSite_AddSourceServerBuilder_NextStep<T>> {
    private serverFetch?: ServerFetch<T>;

    constructor(private readonly webSite: JopiWebSiteBuilder, private readonly internals: WebSiteInternal) {
        super();

        this.internals.afterHook.push(async webSite => {
            if (this.serverFetch) {
                webSite.addSourceServer(this.serverFetch);
            }
        });
    }

    protected override createNextStep(options: ServerFetchOptions<T>): WebSite_AddSourceServerBuilder_NextStep<T> {
        return new WebSite_AddSourceServerBuilder_NextStep(this.webSite, this.internals, options);
    }

    END_add_sourceServer(): JopiWebSiteBuilder {
        return this.webSite;
    }

    add_sourceServer<T>(): WebSite_AddSourceServerBuilder<T> {
        return new WebSite_AddSourceServerBuilder<T>(this.webSite, this.internals);
    }
}

class WebSite_AddSourceServerBuilder_NextStep<T> extends CreateServerFetch_NextStep<T> {
    constructor(private readonly webSite: JopiWebSiteBuilder, private readonly internals: WebSiteInternal, options: ServerFetchOptions<T>) {
        super(options);

        this.internals.afterHook.push(async webSite => {
            webSite.addSourceServer(ServerFetch.useAsIs(this.options));
        });
    }

    END_add_sourceServer(): JopiWebSiteBuilder {
        return this.webSite;
    }

    add_sourceServer<T>(): WebSite_AddSourceServerBuilder<T> {
        return new WebSite_AddSourceServerBuilder<T>(this.webSite, this.internals);
    }
}

/** Configuration builder for global middlewares. */
class WebSite_MiddlewareBuilder {
    constructor(private readonly webSite: JopiWebSiteBuilder, private readonly internals: WebSiteInternal) {
    }

    /** 
     * Adds a middleware that executes BEFORE the request handler. 
     * @param method HTTP method filter (null = all).
     * @param middleware Middleware function.
     * @param options Execution options (priority, etc.).
     */
    add_middleware(method: HttpMethod | undefined, middleware: JopiMiddleware, options?: MiddlewareOptions): WebSite_MiddlewareBuilder {
        this.internals.afterHook.push(async webSite => {
            webSite.addGlobalMiddleware(method, middleware, options);
        });

        return this;
    }

    /** 
     * Adds a middleware that executes AFTER the request handler (post-process).
     * @param method HTTP method filter.
     * @param middleware Post-middleware function.
     * @param options Execution options.
     */
    add_postMiddleware(method: HttpMethod | undefined, middleware: JopiPostMiddleware, options?: MiddlewareOptions): WebSite_MiddlewareBuilder {
        this.internals.afterHook.push(async webSite => {
            webSite.addGlobalPostMiddleware(method, middleware, options);
        });

        return this;
    }

    END_configure_middlewares(): JopiWebSiteBuilder {
        return this.webSite;
    }
}

/** Configuration builder for the page and API cache system. */
class WebSite_HtmlCacheBuilder {
    private cache?: PageCache;
    private readonly rules: CacheRules[] = [];

    constructor(private readonly webSite: JopiWebSiteBuilder, private readonly internals: WebSiteInternal) {
        this.internals.afterHook.push(async webSite => {
            webSite.setHtmlCacheRules(this.rules);

            if (this.cache) {
                webSite.setHtmlCache(this.cache);
            }
        });
    }

    /** Use a standard RAM-based cache. */
    use_inMemoryCache(options?: InMemoryCacheOptions): WebSite_HtmlCacheBuilder {
        if (options) initMemoryCache(options);
        this.cache = getInMemoryCache();

        return this;
    }

    /** Use a disk-based cache stored in a specific directory. */
    use_fileSystemCache(rootDir: string): WebSite_HtmlCacheBuilder {
        this.cache = new SimpleFileCache(rootDir);
        return this;
    }

    /** Defines custom rules for what should or shouldn't be cached. */
    add_cacheRules(rules: CacheRules): WebSite_HtmlCacheBuilder {
        this.rules.push(rules);
        return this;
    }

    END_configure_htmlCache(): JopiWebSiteBuilder {
        return this.webSite;
    }
}

/** Configuration builder for the object cache system. */
class WebSite_ObjectCacheBuilder {
    private cache?: ObjectCache;

    constructor(private readonly webSite: JopiWebSiteBuilder, private readonly internals: WebSiteInternal) {
        this.internals.afterHook.push(async webSite => {
            if (this.cache) {
                webSite.setObjectCache(this.cache);
            }
        });
    }

    /** Use a standard RAM-based object cache. */
    use_inMemoryCache(options?: InMemoryObjectCacheOptions): WebSite_ObjectCacheBuilder {
        if (options) initMemoryObjectCache(options);
        this.cache = getInMemoryObjectCache();

        return this;
    }

    /** Use a disk-based object cache stored in a specific directory. */
    use_fileSystemCache(rootDir: string): WebSite_ObjectCacheBuilder {
        this.cache = new FileObjectCache(rootDir);
        return this;
    }

    END_configure_objectCache(): JopiWebSiteBuilder {
        return this.webSite;
    }
}


interface WebSite_ConfigureBehaviors {
    /**
     * Allows adding trailing slash at end of the urls.
     * The default behavior is to remove them.
     */
    enableTrailingSlashes(value: boolean | undefined): WebSite_ConfigureBehaviors;



    /**
     * Defines default options for all cookies created on the server side. 
     * These defaults are merged with specific options passed to `cookie_addCookieToRes`.
     */
    setCookieDefaults(options: CookieOptions): WebSite_ConfigureBehaviors;

    DONE_configure_behaviors(): JopiWebSiteBuilder;
}

interface WebSite_ConfigureDevBehaviors {
    /**
     * Allows adding a pause (in ms) before returning DataSource values.
     * This is mainly to test waiting screens.
     */
    slowDownHttpDataSources(pauseMs: number): WebSite_ConfigureDevBehaviors;

    DONE_configure_devBehaviors(): JopiWebSiteBuilder;
}

//endregion

//region Server starting

let gIsAutoStartDone = false;

async function autoStartServer() {
    if (gIsAutoStartDone) return;
    gIsAutoStartDone = true;

    await jk_timer.tick(5);
    await myServer.startServer();
}

const myServer = getServer();

//endregion

//region TLS Certificates

//region CertificateBuilder

let gIsSslCertificateDefined = false;

function useCertificateStore(dirPath: string, hostName: string) {
    dirPath = path.join(dirPath, hostName);

    let cert: string = "";
    let key: string = "";

    try {
        cert = path.resolve(dirPath, "certificate.crt.key")
        fsc.statfsSync(cert)
    } catch {
        console.error("Certificat file not found: ", cert);
    }

    try {
        key = path.resolve(dirPath, "certificate.key")
        fsc.statfsSync(key)
    } catch {
        console.error("Certificat key file not found: ", key);
    }

    return { key, cert };
}

/** Configuration builder for TLS/SSL certificates. */
class CertificateBuilder {
    constructor(private readonly parent: JopiWebSiteBuilder, private readonly internals: WebSiteInternal) {
    }

    /** 
     * Generates a local self-signed certificate using mkcert.
     * Essential for local HTTPS development.
     * @param saveInDir Directory to store the certificates (default: "certs").
     */
    generate_localDevCert(saveInDir: string = "certs") {
        gIsSslCertificateDefined = true;

        this.internals.beforeHook.push(async () => {
            try {
                this.internals.options.certificate = await myServer.createDevCertificate(this.internals.hostName, saveInDir);
            }
            catch {
                console.error(`Can't create ssl certificate for ${this.internals.hostName}. Is mkcert tool installed ?`);
            }
        });

        return {
            DONE_add_httpCertificate: () => this.parent
        }
    }

    /** 
     * Uses pre-existing certificate files from a directory.
     * The directory should contain `certificate.crt` and `certificate.key`.
     */
    use_dirStore(dirPath: string) {
        gIsSslCertificateDefined = true;
        this.internals.options.certificate = useCertificateStore(dirPath, this.internals.hostName);
        return { DONE_add_httpCertificate: () => this.parent }
    }

    /** 
     * Configures automatic certificate generation via Let's Encrypt (ACME). 
     * @param email Contact email for Let's Encrypt.
     */
    generate_letsEncryptCert(email: string) {
        gIsSslCertificateDefined = true;

        const params: LetsEncryptParams = { email };

        this.internals.afterHook.push(async webSite => {
            await getLetsEncryptCertificate(webSite, params);
        });

        return new LetsEncryptCertificateBuilder(this.parent, params);
    }
}

//endregion

//region LetsEncryptCertificateBuilder

/** Configuration builder for Let's Encrypt certificates. */
class LetsEncryptCertificateBuilder {
    constructor(private readonly parent: JopiWebSiteBuilder, private readonly params: LetsEncryptParams) {
    }

    DONE_add_httpCertificate() {
        return this.parent;
    }

    /** Enables production mode for Let's Encrypt. If false, uses Staging/Testing servers. */
    enable_production(value: boolean = true) {
        this.params.isProduction = value;
        return this;
    }

    /** Disables logging for the ACME challenge process. */
    disable_log() {
        this.params.log = false;
        return this;
    }

    /** Directory where certificates will be saved. */
    set_certificateDir(dirPath: string) {
        this.params.certificateDir = dirPath;
        return this;
    }

    /** Forces certificate renewal if it expires in less than X days. */
    force_expireAfter_days(dayCount: number) {
        this.params.expireAfter_days = dayCount;
        return this;
    }

    /** Sets the challenge timeout. */
    force_timout_sec(value: number) {
        this.params.timeout_sec = value;
        return this;
    }

    /** Handler called if the certificate challenge times out. */
    if_timeOutError(handler: OnTimeoutError) {
        this.params.onTimeoutError = handler;
        return this;
    }
}

//endregion

//endregion

//region JWT Tokens

//region Interfaces

/** Step 1: Provide the secret key for JWT signing. */
interface JWT_BEGIN {
    step_setPrivateKey(privateKey: string): JWT_StepBegin_SetUserStore;
}

/** Final step: Return to main website builder. */
interface JWT_FINISH {
    DONE_configure_jwtTokenAuth(): JopiWebSiteBuilder;
}

/** Step 2: Transition to user store selection. */
interface JWT_StepBegin_SetUserStore {
    step_setUserStore(): JWT_Step_SetUserStore;
}

/** Step 3: Choose a user store (simple login/password or custom). */
interface JWT_Step_SetUserStore {
    /** Use a built-in store for static logins and passwords. */
    use_simpleLoginPassword(): JWT_UseSimpleLoginPassword;

    /** Use a custom function to validate users (e.g. from a database). */
    use_customStore<T>(store: UserAuthentificationFunction<T>): JWT_UseCustomStore;
}

/** Configuration for custom auth handler. */
interface JWT_UseCustomStore {
    DONE_use_customStore(): JWT_StepBegin_Configure;
}

/** Configuration for the simple login/password store. */
interface JWT_UseSimpleLoginPassword {
    /** Adds a single user to the store. */
    addOne(login: string, password: string, userInfos: UserInfos): JWT_UseSimpleLoginPassword;
    /** Adds multiple users from an array. */
    addMany(users: UserInfos_WithLoginPassword[]): JWT_UseSimpleLoginPassword;
    DONE_use_simpleLoginPassword(): JWT_StepBegin_Configure;
}

/** Step 4: Finalize or further configure the JWT settings. */
interface JWT_StepBegin_Configure {
    /** Proceed to advanced configuration (tokens, cookies, etc.). */
    stepConfigure(): JWT_Step_Configure;
    /** Finish with default settings. */
    DONE_setUserStore(): JWT_FINISH;
}

/** Advanced JWT configuration. */
interface JWT_Step_Configure {
    /** Sets the duration of the authorization cookie in hours. */
    set_cookieDuration(expirationDuration_hours: number): JWT_Step_Configure;
    DONE_stepConfigure(): JWT_FINISH;
}

//endregion

/** Internal builder class for the JWT authentication fluent API. */
class JwtTokenAuth_Builder {
    constructor(private readonly parent: JopiWebSiteBuilder, private readonly internals: WebSiteInternal) {
    }

    FINISH() {
        return {
            DONE_configure_jwtTokenAuth: () => this.parent
        }
    }

    //region setPrivateKey_STEP (BEGIN / root)

    /** Entry point: sets the signing key. */
    setPrivateKey_STEP(privateKey: string): JWT_StepBegin_SetUserStore {
        this.internals.afterHook.push(async webSite => {
            webSite.setJwtSecret(privateKey);
        });

        return {
            step_setUserStore: () => this.setUserStore_STEP()
        }
    }

    //endregion

    //region setUserStore_STEP

    private loginPasswordStore?: UserStore_WithLoginPassword;

    /** Transitions to choosing a user store. */
    setUserStore_STEP(): JWT_Step_SetUserStore {
        const self = this;

        return {
            use_simpleLoginPassword: () => {
                this.loginPasswordStore = new UserStore_WithLoginPassword();

                this.internals.afterHook.push(async webSite => {
                    this.loginPasswordStore!.setAuthHandler(webSite);
                });

                return this.useSimpleLoginPassword_BEGIN();
            },

            use_customStore<T>(store: UserAuthentificationFunction<T>) { return self.useCustomStore_BEGIN<T>(store) }
        }
    }

    _setUserStore_NEXT(): JWT_StepBegin_Configure {
        return {
            stepConfigure: () => this.stepConfigure(),
            DONE_setUserStore: () => this.FINISH(),
        }
    }

    //region useCustomStore

    useCustomStore_BEGIN<T>(store: UserAuthentificationFunction<T>) {
        this.internals.afterHook.push(async webSite => {
            webSite.setAuthHandler(store);
        })

        return {
            DONE_use_customStore: () => this.useCustomStore_DONE()
        }
    }

    useCustomStore_DONE() {
        return this._setUserStore_NEXT();
    }

    //endregion

    //region useSimpleLoginPassword

    useSimpleLoginPassword_BEGIN(): JWT_UseSimpleLoginPassword {
        return this._useSimpleLoginPassword_REPEAT();
    }

    useSimpleLoginPassword_DONE(): JWT_StepBegin_Configure {
        return this._setUserStore_NEXT();
    }

    _useSimpleLoginPassword_REPEAT(): JWT_UseSimpleLoginPassword {
        return {
            addOne: (login: string, password: string, userInfos: UserInfos) => this.useSimpleLoginPassword_addOne(login, password, userInfos),
            addMany: (users: UserInfos_WithLoginPassword[]) => this.useSimpleLoginPassword_addMany(users),
            DONE_use_simpleLoginPassword: () => this.useSimpleLoginPassword_DONE()
        }
    }

    useSimpleLoginPassword_addOne(login: string, password: string, userInfos: UserInfos): JWT_UseSimpleLoginPassword {
        this.loginPasswordStore!.add({ login, password, userInfos });

        return this._useSimpleLoginPassword_REPEAT();
    }

    useSimpleLoginPassword_addMany(users: UserInfos_WithLoginPassword[]): JWT_UseSimpleLoginPassword {
        users.forEach(e => this.loginPasswordStore!.add(e));
        return this._useSimpleLoginPassword_REPEAT();
    }

    //endregion

    //endregion

    //region setTokenStore

    stepConfigure(): JWT_Step_Configure {
        return {
            set_cookieDuration: (expirationDuration_hours: number) => this.setTokenStore_useCookie(expirationDuration_hours),
            DONE_stepConfigure: () => this.FINISH()
        }
    }

    /** Configures automatic authorization cookie handling. */
    setTokenStore_useCookie(expirationDuration_hours: number = 3600) {
        this.internals.afterHook.push(async webSite => {
            webSite.setJwtTokenStore((_token, cookieValue, req) => {
                // User authorization must stay as long as possible (High priority)
                // in case of browser cookies eviction conflict.
                //
                req.cookie_addCookieToRes("authorization", cookieValue, { maxAge: jk_timer.ONE_HOUR * expirationDuration_hours, priority: "High" })
            });
        });

        return this.stepConfigure();
    }

    //endregion
}

//endregion

//region Crawler

let gCrawlerOptions: WebSiteCrawlerOptions = {
    requireRelocatableUrl: true,
    pauseDuration_ms: 0,
    outputDir: "static"
};

/** Configuration builder for the satic-site generator (SSG crawler). */
class WebSite_CrawlerBuilder {
    private readonly crawlerOptions = gCrawlerOptions;

    constructor(private webSite: JopiWebSiteBuilder) {
    }

    /** Sets the directory where the crawler will save the files. */
    set_outputDir(rootDir: string): this {
        this.crawlerOptions.outputDir = rootDir;
        return this;
    }

    /** Sets the cache engine to use for crawling. */
    set_cache(cache: WebSiteCrawlerOptions["cache"]): this {
        this.crawlerOptions.cache = cache;
        return this;
    }

    /** Sets the duration of the pause between two calls to the server. */
    set_pauseDuration(ms: number): this {
        this.crawlerOptions.pauseDuration_ms = ms;
        return this;
    }

    /** Sets the new website URL if it differs from the source. */
    set_newWebSiteUrl(url: string): this {
        this.crawlerOptions.newWebSiteUrl = url;
        return this;
    }

    /** Sets the URL mapping for the crawler. */
    set_urlMapping(mapping: WebSiteCrawlerOptions["urlMapping"]): this {
        this.crawlerOptions.urlMapping = mapping;
        return this;
    }

    /** Enables or disables the generation of relocatable URLs (using relative paths). */
    enable_relocatableUrl(value: boolean = true): this {
        this.crawlerOptions.requireRelocatableUrl = value;
        return this;
    }

    /** Adds a URL that must be specifically scanned. */
    add_scanUrl(url: string): this {
        if (!this.crawlerOptions.scanThisUrls) this.crawlerOptions.scanThisUrls = [];
        this.crawlerOptions.scanThisUrls.push(url);
        return this;
    }

    /** Adds a URL prefix that should be rewritten during crawling. */
    add_rewriteUrl(url: string): this {
        if (!this.crawlerOptions.rewriteThisUrls) this.crawlerOptions.rewriteThisUrls = [];
        this.crawlerOptions.rewriteThisUrls.push(url);
        return this;
    }

    /** Callback to transform a URL found by the crawler. */
    on_transformUrl(handler: WebSiteCrawlerOptions["transformUrl"]): this {
        this.crawlerOptions.transformUrl = handler;
        return this;
    }

    /** Callback to rewrite HTML before link extraction. */
    on_rewriteHtmlBeforeProcessing(handler: WebSiteCrawlerOptions["rewriteHtmlBeforeProcessing"]): this {
        this.crawlerOptions.rewriteHtmlBeforeProcessing = handler;
        return this;
    }

    /** Callback to rewrite HTML after link extraction but before storing. */
    on_rewriteHtmlBeforeStoring(handler: WebSiteCrawlerOptions["rewriteHtmlBeforeStoring"]): this {
        this.crawlerOptions.rewriteHtmlBeforeStoring = handler;
        return this;
    }

    /** Callback called once a page is entirely downloaded. */
    on_pageFullyDownloaded(handler: WebSiteCrawlerOptions["onPageFullyDownloaded"]): this {
        this.crawlerOptions.onPageFullyDownloaded = handler;
        return this;
    }

    /** Callback called when a resource (.js, .css, .png, etc.) is downloaded. */
    on_resourceDownloaded(handler: WebSiteCrawlerOptions["onResourceDownloaded"]): this {
        this.crawlerOptions.onResourceDownloaded = handler;
        return this;
    }

    /** Callback to sort or filter the list of pages to download. */
    on_sortPagesToDownload(handler: WebSiteCrawlerOptions["sortPagesToDownload"]): this {
        this.crawlerOptions.sortPagesToDownload = handler;
        return this;
    }

    /** Callback to decide if a non-200 response should be retried. */
    on_invalidResponseCodeFound(handler: WebSiteCrawlerOptions["onInvalidResponseCodeFound"]): this {
        this.crawlerOptions.onInvalidResponseCodeFound = handler;
        return this;
    }

    /** Callback to decide if a URL should be downloaded. */
    on_canDownload(handler: WebSiteCrawlerOptions["canDownload"]): this {
        this.crawlerOptions.canDownload = handler;
        return this;
    }

    /** Callback called when a URL has been processed (useful for stats). */
    on_urlProcessed(handler: WebSiteCrawlerOptions["onUrlProcessed"]): this {
        this.crawlerOptions.onUrlProcessed = handler;
        return this;
    }

    /** Callback called when the crawling process is finished. */
    on_finished(handler: WebSiteCrawlerOptions["onFinished"]): this {
        this.crawlerOptions.onFinished = handler;
        return this;
    }

    /** Replace the default fetch implementation. */
    do_fetch(handler: WebSiteCrawlerOptions["doFetch"]): this {
        this.crawlerOptions.doFetch = handler;
        return this;
    }

    END_configure_crawler(): JopiWebSiteBuilder {
        return this.webSite;
    }
}

function executeCrawler() {
    const ssgEnv = getSsgEnvValue();

    if (ssgEnv) {
        if (ssgEnv !== "1") {
            gCrawlerOptions.outputDir = ssgEnv;
        }
        
        const crawler = new WebSiteCrawler(getWebSiteConfig().webSiteUrl, gCrawlerOptions);
        
        setTimeout(async () => {
                jk_term.logBgBlue("JopiJS - Starting SSG crawler...");
                await crawler.start();

                jk_term.logBgGreen("JopiJS - SSG Finished.");
                process.exit(0);
            },
        
            // Allows waiting the website to be initialized.
            4000
        );

        jk_term.logBgBlue("JopiJS - SSG crawler waiting server init.");
    }
}

//endregion

//region Config

export function getSsgEnvValue(): string | undefined {
    // Disabled if we are inside the worker process.
    if (process.env.JOPI_WORKER_MODE === "1") return undefined;
    return getSsgEnvValueRaw();
}

function getSsgEnvValueRaw(): string | undefined {
    for (let i = 0; i < process.argv.length; i++) {
        const arg = process.argv[i];

        if (arg === "--jopi-ssg") {
            const next = process.argv[i + 1];
            if (next && !next.startsWith("-")) return next;
            return "1";
        }
    }

    return process.env.JOPI_SSG || process.env.JOPI_CRAWLER;
}


/** List of allowed origins for CORS. */
let gCorsConstraints: string[] = [];
/** If true, the CORS middleware will be completely disabled. */
let giIsCorsDisabled = false;


//endregion