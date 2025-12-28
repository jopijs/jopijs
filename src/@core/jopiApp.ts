// noinspection JSUnusedGlobalSymbols

import path from "node:path";
import fsc from "node:fs";
import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_timer from "jopi-toolkit/jk_timer";
import * as jk_term from "jopi-toolkit/jk_term";
import * as jk_events from "jopi-toolkit/jk_events";

import type {Config as TailwindConfig} from 'tailwindcss';
import {type FetchOptions, type ServerDownResult, ServerFetch, type ServerFetchOptions} from "./serverFetch.ts";
import {getLetsEncryptCertificate, type LetsEncryptParams, type OnTimeoutError} from "./letsEncrypt.ts";
import {type UserInfos_WithLoginPassword, UserStore_WithLoginPassword} from "./userStores.ts";
import {getBundlerConfig, type PostCssInitializer} from "./bundler/index.ts";
import {getInMemoryCache, initMemoryCache, type InMemoryCacheOptions} from "./caches/InMemoryCache.ts";
import {SimpleFileCache} from "./caches/SimpleFileCache.ts";
import {JopiRequest} from "./jopiRequest.ts";

import {
    type CacheRules,
    type HttpMethod,
    type JopiMiddleware,
    type JopiPostMiddleware,
    type MiddlewareOptions,
    type UserAuthentificationFunction,
    type UserInfos,
    type CoreWebSite,
    CoreWebSiteImpl,
    WebSiteOptions
} from "./jopiCoreWebSite.tsx";

import type {PageCache} from "./caches/cache.ts";
import {getServer, type SseEvent} from "./jopiServer.ts";
import {getPackageJsonConfig} from "jopijs/loader-tools";
import {initLinker} from "./linker.ts";
import {addStaticEvent as linker_addStaticEvent} from "jopijs/linker";
import {logServer_startApp} from "./_logs.ts";
import type {LoggerGroupCallback} from "jopi-toolkit/jk_logs";
import {setHttpProxyReadPause} from "./dataSources.ts";
import {isDevelopment} from "jopi-toolkit/jk_process";

class JopiApp {
    private _isStartAppSet: boolean = false;

    startApp(importMeta: any, f: (webSite: JopiWebSite) => void|Promise<void>): void {
        const doStart = async () => {
            await jk_app.waitServerSideReady();
            await jk_app.declareAppStarted();

            const url = this.getDefaultUrl();
            const webSite = new WebSite_ExposePrivate(url);

            let res = f(webSite);
            if (res instanceof Promise) await res;
        }

        if (this._isStartAppSet) throw "App is already started";
        this._isStartAppSet = true;

        if (isDevelopment) {
            jk_term.logBgBlue("You are running in development mode. Set env var NODE_ENV to 'production' to disable this message.")
        }

        jk_app.setApplicationMainFile(importMeta.filename);
        doStart().then();
    }

    private getDefaultUrl(): string {
        let config = getPackageJsonConfig();

        if (config.webSiteListeningUrl) return config.webSiteListeningUrl;
        if (config.webSiteUrl) return config.webSiteUrl;

        throw new Error("Invalid package.json configuration. 'jopi.webSiteUrl' or 'jopi.webSiteListeningUrl' must be set");
    }
}

let gMetricsOnWebsiteStarted: LoggerGroupCallback = logServer_startApp.beginInfo("Starting Application");

export const jopiApp = new JopiApp();

//region CreateServerFetch

class CreateServerFetch<T, R extends CreateServerFetch_NextStep<T>> {
    protected options?: ServerFetchOptions<T>;

    protected createNextStep(options: ServerFetchOptions<T>): R {
        return new CreateServerFetch_NextStep(options) as R;
    }

    /**
     * The server will be call with his IP and not his hostname
     * which will only be set in the headers. It's required when
     * the DNS doesn't pinpoint to the god server.
     */
    useIp(serverOrigin: string, ip: string, options?: ServerFetchOptions<T>): R {
        let rOptions = ServerFetch.getOptionsFor_useIP<T>(serverOrigin, ip, options);
        this.options = rOptions;
        return this.createNextStep(rOptions);
    }

    useOrigin(serverOrigin: string, options?: ServerFetchOptions<T>): R {
        let rOptions = ServerFetch.getOptionsFor_useOrigin<T>(serverOrigin, options);
        this.options = rOptions;
        return this.createNextStep(rOptions);
    }
}

class CreateServerFetch_NextStep<T> {
    constructor(protected options: ServerFetchOptions<T>) {
    }

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

    on_beforeRequesting(handler: (url: string, fetchOptions: FetchOptions, data: T)=>void|Promise<void>): this {
        this.options.beforeRequesting = handler;
        return this;
    }

    on_ifServerIsDown(handler: (builder: IfServerDownBuilder<T>)=>void|Promise<void>): this {
        this.options.ifServerIsDown = async (_fetcher, data) => {
            const {builder, getResult} = IfServerDownBuilder.newBuilder<T>(data);

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
        return {builder: b, getResult: () => b.options};
    }
}

//endregion

//region WebSite

export interface FileServerOptions {
    rootDir: string;
    replaceIndexHtml: boolean,
    onNotFound: (req: JopiRequest) => Response|Promise<Response>
}

export class JopiWebSite {
    protected readonly origin: string;
    protected readonly hostName: string;
    private webSite?: CoreWebSiteImpl;
    protected readonly options: WebSiteOptions = {};

    protected readonly afterHook: ((webSite: CoreWebSite)=>(Promise<void>))[] = [];
    protected readonly beforeHook: (()=>Promise<void>)[] = [];

    protected readonly internals: WebSiteInternal;
    protected _isWebSiteReady: boolean = false;

    protected fileServerOptions: FileServerOptions;

    public readonly events = jk_events.defaultEventGroup;

    constructor(url: string) {
        setTimeout(async () => {
            await this.initWebSiteInstance();
        }, 1);

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
        this.add_staticEvent("app.user.infosUpdated");
        this.add_staticEvent("app.menu.click");
        this.add_staticEvent("app.menu.invalided");
        this.add_staticEvent("app.menu.activeItemChanged");
    }

    private async initWebSiteInstance(): Promise<void> {
        const onWebSiteCreate = (h: (webSite: CoreWebSite) => void|Promise<void>) => {
            this.internals.afterHook.push(h);
        }

        if (!this.webSite) {
            await initLinker(this, onWebSiteCreate);

            for (let hook of this.beforeHook) await hook();

            this.webSite = new CoreWebSiteImpl(this.origin, this.options);

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

    hook_webSite(hook: (webSite: CoreWebSite) => void): this {
        this.internals.onHookWebSite = hook;
        return this;
    }

    DONE_createWebSite(): JopiApp {
        return jopiApp;
    }

    add_httpCertificate(): CertificateBuilder {
        return new CertificateBuilder(this, this.internals);
    }

    fastConfigure_fileServer(options: FileServerOptions): JopiWebSite {
        this.fileServerOptions = options;
        return this;
    }

    configure_fileServer() {
        const parent = this;

        const me = {
            set_rootDir: (rootDir: string) => {
                this.fileServerOptions.rootDir = rootDir;
                return me;
            },

            set_onNotFound: (handler: (req: JopiRequest) => Response|Promise<Response>) => {
                this.fileServerOptions.onNotFound = handler;
                return me;
            },

            DONE_configure_fileServer: (): JopiWebSite => {
                return parent;
            }
        };

        return me;
    }

    configure_jwtTokenAuth(): JWT_BEGIN {
        const builder = new JwtTokenAuth_Builder(this, this.internals);

        return {
            step_setPrivateKey: (privateKey: string) => builder.setPrivateKey_STEP(privateKey)
        }
    }

    fastConfigure_jwtTokenAuth<T>(privateKey: string, store: any[] | UserAuthentificationFunction<T>): JopiWebSite {
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

    add_SseEvent(path: string|string[], handler: SseEvent): JopiWebSite {
        this.internals.afterHook.push((webSite) => {
            webSite.addSseEVent(path, handler);
        });

        return this;
    }

    /**
     * Allows the linker to generate an event entry.
     * Will allow to do `import myEvent from "@/events/myEventName`
     */
    add_staticEvent(name: string): JopiWebSite {
        linker_addStaticEvent(name);
        return this;
    }

    configure_postCss() {
        const parent: JopiWebSite = this;

        const me = {
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

    configure_behaviors(): WebSite_ConfigureBehaviors {
        const parent: JopiWebSite = this;

        const me: WebSite_ConfigureBehaviors = {
            enableTrailingSlashes(value: boolean = true) {
                parent.options.removeTrailingSlash = !value;
                return me;
            },

            DONE_configure_behaviors(): JopiWebSite {
                return parent;
            }
        }

        return me;
    }

    configure_devBehaviors(): WebSite_ConfigureDevBehaviors {
        const parent: JopiWebSite = this;

        const me: WebSite_ConfigureDevBehaviors = {
            slowDownHttpDataSources(pauseMs: number) {
                if (isDevelopment) {
                    setHttpProxyReadPause(pauseMs);
                }
                return me;
            },

            DONE_configure_devBehaviors(): JopiWebSite {
                return parent;
            }
        }

        return me;
    }

    configure_cache(): WebSite_CacheBuilder {
        return new WebSite_CacheBuilder(this, this.internals);
    }

    configure_middlewares(): WebSite_MiddlewareBuilder {
        return new WebSite_MiddlewareBuilder(this, this.internals);
    }

    configure_bundler() {
        const parent: JopiWebSite = this;

        const me = {
            dontEmbed_ReactJS: () => {
                me.dontEmbedThis("react", "react-dom");
                return me;
            },

            dontEmbedThis: (...packages: string[]) => {
                let config = getBundlerConfig();
                if (!config.embed.dontEmbedThis) config.embed.dontEmbedThis = [];
                config.embed.dontEmbedThis.push(...packages);
                return me;
            },

            END_configure_bundler(): JopiWebSite {
                return parent;
            }
        }

        return me;
    }

    configure_tailwindProcessor() {
        const parent: JopiWebSite = this;

        const me = {
            disableTailwind: () => {
                getBundlerConfig().tailwind.disable = true;
                return me;
            },

            setGlobalCssContent: (template: string) => {
                getBundlerConfig().tailwind.globalCssContent = template;
                return me;
            },

            setConfig: (config: TailwindConfig) => {
                getBundlerConfig().tailwind.config = config;
                return me;
            },

            /**
             * Allows adding extra-sources files to scan.
             * Can also be motifs. Ex: "./myDir/*.{js,ts,jsx,tsx}"
             */
            addExtraSourceFiles: (...files: string[]) => {
                const config = getBundlerConfig().tailwind;
                if (!config.extraSourceFiles) config.extraSourceFiles = [];
                config.extraSourceFiles.push(...files);
                return me;
            },

            setGlobalCssFilePath: (filePath: string) => {
                const config = getBundlerConfig().tailwind;
                config.globalCssFilePath = filePath;
                return me;
            },

            END_configure_tailwindProcessor(): JopiWebSite {
                return parent;
            }
        }

        return me;
    }

    add_sourceServer<T>(): WebSite_AddSourceServerBuilder<T> {
        return new WebSite_AddSourceServerBuilder<T>(this, this.internals);
    }

    add_specialPageHandler(): WebSite_AddSpecialPageHandler {
        return new WebSite_AddSpecialPageHandler(this, this.internals);
    }

    on_webSiteReady(listener: () => void) {
        if (this._isWebSiteReady) {
            listener();
            return;
        }

        this.options.onWebSiteReady!.push(listener);
        return this;
    }

    configure_cors() {
        return new WebSite_ConfigureCors(this);
    }

    fastConfigure_cors(allowedHosts?: string[]): JopiWebSite {
        const b = new WebSite_ConfigureCors(this);

        if (allowedHosts) {
            allowedHosts.forEach(o => b.add_allowedHost(o));
        }

        return this;
    }
}

interface WebSiteInternal {
    origin: string;
    hostName: string;
    options: WebSiteOptions;

    afterHook: ((webSite: CoreWebSite) => void|Promise<void>)[];
    beforeHook: (() => Promise<void>)[];

    onHookWebSite?: (webSite: CoreWebSite) => void;
}

class WebSite_ExposePrivate extends JopiWebSite {
    isWebSiteReady() {
        return this._isWebSiteReady;
    }

    getInternals(): WebSiteInternal {
        return this.internals;
    }
}

class WebSite_ConfigureCors {
    constructor(private readonly webSite: JopiWebSite) {
    }

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

    disable_cors() {
        giIsCorsDisabled = true;
        return this;
    }

    DONE_configure_cors(): JopiWebSite {
        return this.webSite;
    }
}

class WebSite_AddSpecialPageHandler {
    constructor(private readonly webSite: JopiWebSite, private readonly internals: WebSiteInternal) {
    }

    END_add_specialPageHandler(): JopiWebSite {
        return this.webSite;
    }

    on_404_NotFound(handler: (req: JopiRequest) => Promise<Response>): this {
        this.internals.afterHook.push(async webSite => {
            webSite.on404_NotFound(handler);
        });

        return this;
    }

    on_500_Error(handler: (req: JopiRequest) => Promise<Response>): this {
        this.internals.afterHook.push(async webSite => {
            webSite.on500_Error(handler);
        });

        return this;
    }

    on_401_Unauthorized(handler: (req: JopiRequest) => Promise<Response>): this {
        this.internals.afterHook.push(async webSite => {
            webSite.on401_Unauthorized(handler);
        });

        return this;
    }
}

class WebSite_AddSourceServerBuilder<T> extends CreateServerFetch<T, WebSite_AddSourceServerBuilder_NextStep<T>> {
    private serverFetch?: ServerFetch<T>;

    constructor(private readonly webSite: JopiWebSite, private readonly internals: WebSiteInternal) {
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

    END_add_sourceServer(): JopiWebSite {
        return this.webSite;
    }

    add_sourceServer<T>(): WebSite_AddSourceServerBuilder<T> {
        return new WebSite_AddSourceServerBuilder<T>(this.webSite, this.internals);
    }
}

class WebSite_AddSourceServerBuilder_NextStep<T> extends CreateServerFetch_NextStep<T> {
    constructor(private readonly webSite: JopiWebSite, private readonly internals: WebSiteInternal, options: ServerFetchOptions<T>) {
        super(options);

        this.internals.afterHook.push(async webSite => {
            webSite.addSourceServer(ServerFetch.useAsIs(this.options));
        });
    }

    END_add_sourceServer(): JopiWebSite {
        return this.webSite;
    }

    add_sourceServer<T>(): WebSite_AddSourceServerBuilder<T> {
        return new WebSite_AddSourceServerBuilder<T>(this.webSite, this.internals);
    }
}

class WebSite_MiddlewareBuilder {
    constructor(private readonly webSite: JopiWebSite, private readonly internals: WebSiteInternal) {
    }

    add_middleware(method: HttpMethod|undefined, middleware: JopiMiddleware, options?: MiddlewareOptions): WebSite_MiddlewareBuilder {
        this.internals.afterHook.push(async webSite => {
            webSite.addGlobalMiddleware(method, middleware, options);
        });

        return this;
    }

    add_postMiddleware(method: HttpMethod|undefined, middleware: JopiPostMiddleware, options?: MiddlewareOptions): WebSite_MiddlewareBuilder {
        this.internals.afterHook.push(async webSite => {
            webSite.addGlobalPostMiddleware(method, middleware, options);
        });

        return this;
    }

    END_configure_middlewares(): JopiWebSite {
        return this.webSite;
    }
}

class WebSite_CacheBuilder {
    private cache?: PageCache;
    private readonly rules: CacheRules[] = [];

    constructor(private readonly webSite: JopiWebSite, private readonly internals: WebSiteInternal) {
        this.internals.afterHook.push(async webSite => {
            (webSite as CoreWebSiteImpl).setCacheRules(this.rules);

            if (this.cache) {
                webSite.setCache(this.cache);
            }
        });
    }

    use_inMemoryCache(options?: InMemoryCacheOptions): WebSite_CacheBuilder {
        if (options) initMemoryCache(options);
        this.cache = getInMemoryCache();

        return this;
    }

    use_fileSystemCache(rootDir: string): WebSite_CacheBuilder {
        this.cache = new SimpleFileCache(rootDir);
        return this;
    }

    add_cacheRules(rules: CacheRules): WebSite_CacheBuilder {
        this.rules.push(rules);
        return this;
    }

    END_configure_cache(): JopiWebSite {
        return this.webSite;
    }
}

interface WebSite_ConfigureBehaviors {
    /**
     * Allows adding trailing slash at end of the urls.
     * The default behavior is to remove them.
     */
    enableTrailingSlashes(value: boolean|undefined): WebSite_ConfigureBehaviors;

    DONE_configure_behaviors(): JopiWebSite;
}

interface WebSite_ConfigureDevBehaviors {
    /**
     * Allows adding a pause (in ms) before returning DataSource values.
     * This is mainly to test waiting screens.
     */
    slowDownHttpDataSources(pauseMs: number): WebSite_ConfigureDevBehaviors;

    DONE_configure_devBehaviors(): JopiWebSite;
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

    let cert:string = "";
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

    return {key, cert};
}

class CertificateBuilder {
    constructor(private readonly parent: JopiWebSite, private readonly internals: WebSiteInternal) {
    }

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

    use_dirStore(dirPath: string) {
        gIsSslCertificateDefined = true;
        this.internals.options.certificate = useCertificateStore(dirPath, this.internals.hostName);
        return { DONE_add_httpCertificate: () => this.parent }
    }

    generate_letsEncryptCert(email: string) {
        gIsSslCertificateDefined = true;

        const params: LetsEncryptParams = {email};

        this.internals.afterHook.push(async webSite => {
            await getLetsEncryptCertificate(webSite, params);
        });

        return new LetsEncryptCertificateBuilder(this.parent, params);
    }
}

//endregion

//region LetsEncryptCertificateBuilder

class LetsEncryptCertificateBuilder {
    constructor(private readonly parent: JopiWebSite, private readonly params: LetsEncryptParams) {
    }

    DONE_add_httpCertificate() {
        return this.parent;
    }

    enable_production(value: boolean = true) {
        this.params.isProduction = value;
        return this;
    }

    disable_log() {
        this.params.log = false;
        return this;
    }

    set_certificateDir(dirPath: string) {
        this.params.certificateDir = dirPath;
        return this;
    }

    force_expireAfter_days(dayCount: number) {
        this.params.expireAfter_days = dayCount;
        return this;
    }

    force_timout_sec(value: number) {
        this.params.timout_sec = value;
        return this;
    }

    if_timeOutError(handler: OnTimeoutError) {
        this.params.onTimeoutError = handler;
        return this;
    }
}

//endregion

//endregion

//region JWT Tokens

//region Interfaces

interface JWT_BEGIN {
    step_setPrivateKey(privateKey: string): JWT_StepBegin_SetUserStore;
}

interface JWT_FINISH {
    DONE_configure_jwtTokenAuth(): JopiWebSite;
}

interface JWT_StepBegin_SetUserStore {
    step_setUserStore(): JWT_Step_SetUserStore;
}

interface JWT_Step_SetUserStore {
    use_simpleLoginPassword(): JWT_UseSimpleLoginPassword;

    use_customStore<T>(store: UserAuthentificationFunction<T>): JWT_UseCustomStore;
}

interface JWT_UseCustomStore {
    DONE_use_customStore(): JWT_StepBegin_Configure;
}

interface JWT_UseSimpleLoginPassword {
    addOne(login: string, password: string, userInfos: UserInfos): JWT_UseSimpleLoginPassword;
    addMany(users: UserInfos_WithLoginPassword[]): JWT_UseSimpleLoginPassword;
    DONE_use_simpleLoginPassword(): JWT_StepBegin_Configure;
}

interface JWT_StepBegin_Configure {
    stepConfigure(): JWT_Step_Configure;
    DONE_setUserStore(): JWT_FINISH;
}

interface JWT_Step_Configure {
    set_cookieDuration(expirationDuration_hours: number): JWT_Step_Configure;
    DONE_stepConfigure(): JWT_FINISH;
}

//endregion

class JwtTokenAuth_Builder {
    constructor(private readonly parent: JopiWebSite, private readonly internals: WebSiteInternal) {
    }

    FINISH() {
        return {
            DONE_configure_jwtTokenAuth: () => this.parent
        }
    }

    //region setPrivateKey_STEP (BEGIN / root)

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
            DONE_use_customStore : () => this.useCustomStore_DONE()
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
        this.loginPasswordStore!.add({login, password, userInfos});

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

    setTokenStore_useCookie(expirationDuration_hours: number = 3600) {
        this.internals.afterHook.push(async webSite => {
            webSite.setJwtTokenStore((_token, cookieValue, req) => {
                req.cookie_addCookieToRes("authorization", cookieValue, {maxAge: jk_timer.ONE_HOUR * expirationDuration_hours})
            });
        });

        return this.stepConfigure();
    }

    //endregion
}

//endregion

//region Config

let gCorsConstraints: string[] = [];
let giIsCorsDisabled = false;

//endregion