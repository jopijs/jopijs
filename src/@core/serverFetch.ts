// noinspection JSUnusedGlobalSymbols

import {type FetchBodyAccepted} from "./jopiCoreWebSite.ts";
import type {LoadBalancer} from "./loadBalancing.ts";
import {AutomaticStartStop} from "./automaticStartStop.js";
import {JopiRequest} from "./jopiRequest.js";
import {isNodeJS} from "jopi-toolkit/jk_what";

export interface ServerDownResult<T> {
    newServer?: ServerFetch<T>,
    newServerWeight?: number;
}

export interface FetchOptions {
    headers?: Headers;
    method?: string;
    verbose?: boolean;
}

export interface ServerFetchOptions<T> {
    /**
     * Allow automatically removing the trailing slashs for the website root.
     * If I have http://127.0.0.1/, then it's begun http://127.0.0.1
     * Default value is false.
     */
    removeRootTrailingSlash?: boolean;

    /**
     * Is called before a request.
     * Is used to start the server if we are doing headless.
     */
    beforeRequesting?: (url: string, fetchOptions: FetchOptions, data: T)=>void|Promise<void>;

    /**
     * Is called if we detect that the server is down.
     * Allow starting a script which will restart the server
     * or send a mal to the admin.
     *
     * @returns
     *      true if we can retry the call.
     *      false if we can't.
     */
    ifServerIsDown?: (fetcher: ServerFetch<T>, data: T)=>Promise<ServerDownResult<T>|undefined>;

    headers?: Headers;
    userDefaultHeaders?: boolean;
    cookies?: { [key: string]: string };
    verbose?: boolean;

    /**
     * The public URL of the website.
     * It's the url that he must use to build the url in his content.
     * It's not the url of the server where he can be reached.
     *
     * Setting a public url will allow automatically setting the X-Forwarded-Host and X-Forwarded-Proto headers.
     */
    publicUrl?: string | URL;

    /**
     * An object which will be sent to beforeRequesting.
     * Will also be where ifServerIsDown can store his state.
     */
    data? :T;

    /**
     * Allow rewriting the url for complex cases.
     */
    rewriteUrl?: (url: string, headers: Headers, fetcher: ServerFetch<any>)=>URL;

    /**
     * Allow rewriting a redirection.
     */
    translateRedirect?: (url: string)=>URL;

    /**
     * The weight of this server, if using inside a load balancer.
     */
    weight?: number;

    /**
     * If set, then will be called to start the start.
     * The resulting value is the number of seconds to wait for inactivity.
     */
    doStartServer?: (data: any)=>Promise<number>;

    /**
     * If set, then will be called to stop the server when not need anymore.
     */
    doStopServer?: (data: any)=>Promise<void>;
}

export class ServerFetch<T> {
    private readonly options: ServerFetchOptions<T>;
    private lastURL: string | undefined;

    /**
     * The load-balancer will attach himself if this instance
     * is used by a load balancer.
     */
    public loadBalancer?: LoadBalancer;

    /**
     * Create an instance that translates urls from an origin to a destination.
     *      Ex: http://127.0.0.1 --> https://www.mywebiste.com
     *      Ex: https://my-server.com --> https://134.555.666.66:7890 (with hostname: my-server.com)
     *
     * @param publicUrl
     *      The origin of our current website.
     * @param targetUrl
     *      The origin of the target website.
     * @param hostName
     *      Must be set if toOrigin use an IP and not a hostname.
     *      (will set the Host header)
     * @param options
     *      Options for the ServerFetch instance.
     */
    static fromTo<T>(publicUrl: string, targetUrl: string, hostName?: string, options?: ServerFetchOptions<T>): ServerFetch<T> {
        return new ServerFetch<T>(ServerFetch.getOptionsFor_fromTo(publicUrl, targetUrl, hostName, options));
    }

    static getOptionsFor_fromTo<T>(publicUrl: string, targetUrl: string, hostName?: string, options?: ServerFetchOptions<T>): ServerFetchOptions<T> {
        const uPublicUrl = new URL(publicUrl);
        const uTargetUrl = new URL(targetUrl);
        targetUrl = uTargetUrl.toString().slice(0, -1);

        if (!hostName) hostName = uTargetUrl.hostname;

        return {
            ...options,

            rewriteUrl(url: string, headers: Headers) {
                const urlInfos = new URL(url);
                urlInfos.port = uTargetUrl.port;
                urlInfos.protocol = uTargetUrl.protocol;
                urlInfos.hostname = uTargetUrl.hostname;

                if (hostName) {
                    headers.set('Host', hostName);
                }

                return urlInfos;
            },

            translateRedirect(url: string) {
                if (url[0]==="/") {
                    url = targetUrl + url;
                }

                const urlInfos = new URL(url);
                urlInfos.port = uPublicUrl.port;
                urlInfos.protocol = uPublicUrl.protocol;
                urlInfos.hostname = uPublicUrl.hostname;

                return urlInfos;
            }
        };
    }

    static useOrigin<T>(serverOrigin: string, options?: ServerFetchOptions<T>) {
        return new ServerFetch<T>(ServerFetch.getOptionsFor_useOrigin(serverOrigin, options));
    }

    static useIP<T>(serverOrigin: string, ip: string, options?: ServerFetchOptions<T>) {
        return new ServerFetch<T>(ServerFetch.getOptionsFor_useIP(serverOrigin, ip, options));
    }

    static getOptionsFor_useOrigin<T>(serverOrigin: string, options?: ServerFetchOptions<T>): ServerFetchOptions<T> {
        const urlOrigin = new URL(serverOrigin);

        return {
            ...options,

            rewriteUrl(url: string) {
                const urlInfos = new URL(url);
                urlInfos.port = urlOrigin.port;
                urlInfos.protocol = urlOrigin.protocol;
                urlInfos.hostname = urlOrigin.hostname;

                return urlInfos;
            }
        }
    }

    static getOptionsFor_useIP<T>(serverOrigin: string, ip: string, options?: ServerFetchOptions<T>): ServerFetchOptions<T> {
        let urlOrigin = new URL(serverOrigin);
        let hostName = urlOrigin.hostname;
        urlOrigin.hostname = ip;

        return {
            ...options,

            rewriteUrl(url: string, headers: Headers) {
                const urlInfos = new URL(url);
                urlInfos.port = urlOrigin.port;
                urlInfos.protocol = urlOrigin.protocol;
                urlInfos.hostname = urlOrigin.hostname;

                if (hostName) {
                    headers.set('Host', hostName);
                }

                return urlInfos;
            }
        }
    }

    static useAsIs<T>(options?: ServerFetchOptions<T>) {
        return new ServerFetch<T>(options);
    }

    protected constructor(options?: ServerFetchOptions<T>|undefined) {
        options = options || {};
        this.options = options;

        if (!options.data) options.data = {} as T;
        if (!options.headers) options.headers = new Headers();
        if (options.userDefaultHeaders !== false) this.useDefaultHeaders();

        this.compileCookies();

        if (options.doStartServer) {
            let autoStartStop = new AutomaticStartStop({
                onStart: options.doStartServer!,
                onStop: options.doStopServer!
            });

            if (options.beforeRequesting) {
                const beforeRequesting = options.beforeRequesting;
                const doStart = options.doStartServer!;

                options.beforeRequesting = async (url, fetchOptions, data) => {
                    await autoStartStop.start();
                    return beforeRequesting(url, fetchOptions, data);
                }
            } else {
                options.beforeRequesting = () => autoStartStop.start();
            }
        }

        if (options.publicUrl) {
            const url = new URL(options.publicUrl);
            options.headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
            options.headers.set('X-Forwarded-Host', url.host);

            let ignorePort = false;

            if (url.protocol === 'http:') {
                if (!url.port || (url.port === "80")) {
                    ignorePort = true;
                }
            } else {
                if (!url.port || (url.port === "443")) {
                    ignorePort = true;
                }
            }

            if (!ignorePort) {
                options.headers.set('X-Forwarded-Port', url.port);
            }
        }
    }

    async checkIfServerOk(): Promise<boolean> {
        if (!this.lastURL) return false;
        let url = new URL(this.lastURL);
        url.pathname = "/";

        const res = await this.fetch("GET", url);
        return res.status < 500;
    }

    private useDefaultHeaders() {
        const headers = this.options.headers!;

        const json = {
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",

            "connection": "keep-alive",
            "cache-control": "max-age=0",
            "dnt": "1",
            "upgrade-insecure-requests": "1",
            "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
            "sec-fetch-mode": "navigate",
            "sec-fetch-dest": "document",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7,es;q=0.6",
            "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Google Chrome\";v=\"138\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"macOS\"",
            "sec-fetch-site": "none",
            "sec-fetch-user": "?1"
        };

        for (const [key, value] of Object.entries(json)) {
            headers.set(key, value);
        }
   }

    private compileCookies() {
        if (!this.options.cookies) return;
        let cookies = '';

        for (const [name, value] of Object.entries(this.options.cookies)) {
            cookies += `;${name}=${value}`;
        }

        if (cookies) {
            this.options.headers?.set("Cookies", cookies.substring(1));
        }
    }

    /**
     * Allow directly proxy a request as if we were directly asking the target server.
     */
    async directProxy(req: JopiRequest): Promise<Response> {
        return this.doFetch(req.req_method, req.req_urlInfos.href, req.req_body, req.req_headers);
    }

    async fetchWith(req: JopiRequest) {
        return this.doFetch(req.req_method, req.req_urlInfos.href, req.req_body, req.req_headers);
    }

    async fetch(method: string, url: URL, body?: FetchBodyAccepted, headers?: Headers) {
        return this.doFetch(method, url.toString(), body, headers);
    }

    async fetch2(method: string, url: string, body?: FetchBodyAccepted, headers?: Headers) {
        return this.doFetch(method, url, body, headers);
    }

    normalizeUrl(urlInfos: URL): string {
        // To known: urlInfos.toString() always add a "/" at the end of the root.
        // new URL("http://127.0.0.1") --> http://127.0.0.1/

        if (urlInfos.pathname.length<=1 && this.options.removeRootTrailingSlash) {
            return urlInfos.origin;
        }

        return urlInfos.href;
    }

    /**
     * Allow fetching some content.
     */
    private async doFetch(method: string, url: string, body?: FetchBodyAccepted, headers?: Headers): Promise<Response> {
        const bckURL = url;

        if (!headers) {
            if (this.options.headers) headers = this.options.headers;
            else headers = new Headers();
        }

        // Avoid some protections using the referer.
        //headers.delete("Referer");

        if (this.options.rewriteUrl) {
            let urlInfos = this.options.rewriteUrl(url, headers, this);
            url = this.normalizeUrl(urlInfos);
        }

        const fetchOptions: any = {
            method: method,
            headers: headers,
            verbose: this.options.verbose,

            // Allow avoiding automatic redirections.
            // @ts-ignore
            redirect: 'manual',

            body: body,

            // Allow avoiding SSL certificate check.
            //
            rejectUnauthorized: false,
            requestCert: false,

            tls: {
                rejectUnauthorized: false,
                checkServerIdentity: () => { return undefined }
            },

            // Required by node.js
            duplex: "half"
        };

        if (this.options.beforeRequesting) {
            const res = this.options.beforeRequesting(url, fetchOptions, this.options.data!);
            if (res instanceof Promise) await res;
        }

        this.lastURL = url;

        try {
            let r = await fetch(url, fetchOptions);

            if (r.status >= 300 && r.status < 400) {
                let location = r.headers.get('location');

                if (location) {
                    if (this.options.translateRedirect) {
                        location = this.normalizeUrl(this.options.translateRedirect(location));
                        r.headers.set('Location', location);
                    }

                    r = new Response(null, {status: r.status, headers: r.headers});
                }
            }

            if (this.options.verbose) {
                console.log(`Fetched [${r.status}]`, url);
                if (!r.body) console.log("Response hasn't a body");
                const ct = r.headers.get("content-length");
                if (ct !== undefined && ct === '0') console.log(`Response content-length: ${length}`);
            }

            // The response is received gzipped but is deflated.
            // It's why his content-length and content-encoding must be reset.
            if (isNodeJS) {
                let headers = new Headers(r.headers);
                headers.delete("content-length");
                headers.delete("content-encoding");
                r = new Response(r.body, {headers: headers, status: r.status});
            } else {
                r.headers.delete("content-encoding");
                r.headers.delete("content-encoding");
            }

            return r;
        } catch(e) {
            if (this.options.ifServerIsDown) {
                // Allow we to know there is something fishy.
                const result = await this.options.ifServerIsDown(this, this.options.data!);

                // We can retry to send the request?
                if (result && result.newServer) {
                    if (this.loadBalancer) {
                        this.loadBalancer.replaceServer(this, result.newServer, result.newServerWeight);
                    }

                    return result.newServer.doFetch(method, bckURL, body, headers);
                }
            }

            // 521: Web Server Is Down.
            return new Response(null, { status: 521 });
        }
    }
}

// Allow disabling ssl certificate verification.
//
if (isNodeJS) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}