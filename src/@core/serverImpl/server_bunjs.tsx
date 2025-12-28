import type {CoreServer, SseEvent, SseEventController, WebSocketConnectionInfos} from "../jopiServer.ts";
import {
    type HttpMethod, type JopiWebSocket,
    SBPE_DirectSendThisResponseException , type CoreWebSiteImpl, type WebSiteRouteInfos
} from "../jopiCoreWebSite.tsx";
import type {ServerInstanceBuilder} from "../serverInstanceBuilder.ts";
import React from "react";
import * as jk_fs from "jopi-toolkit/jk_fs";
import {getBundleDirPath} from "../bundler/index.ts";
import {hasJopiDevUiFlag} from "jopijs/loader-client";
import {addBrowserCacheControlHeaders, type TryReturnFileParams} from "../browserCacheControl.ts";

//region SSE Events

interface SseClient {
    controller: ReadableStreamDefaultController,
    me: any
    keepAliveInterval?: Timer
}

interface BunSseEvent extends SseEvent {
    clients: SseClient[];
}

/**
 * Is called when a client connects through a GET request.
 */
export async function onSseEvent(sseEvent: SseEvent): Promise<Response> {
    // Serve a reference for this client.
    // To know: stream can't be used because it's not initialized yet.
    const me: {client?: SseClient} = { };

    const stream = new ReadableStream({
        /**
         * Is called when starting to read the stream.
         */
        start(streamController) {
            const nodeSseEvent = sseEvent as BunSseEvent;

            // Occurs only one time.
            if (!nodeSseEvent.clients) {
                nodeSseEvent.clients = [];

                let sseController: SseEventController = {
                    send(eventName: string, data: string) {
                        let toSend = `event: ${eventName}\ndata: ${ JSON.stringify({message: data}) }\n\n`;
                        const encoder = new TextEncoder();
                        const encodedData = encoder.encode(toSend);

                        nodeSseEvent.clients.forEach(e => {
                            e.controller.enqueue(encodedData);
                        });
                    },

                    close() {
                        console.log("SSE close by API");

                        nodeSseEvent.clients.forEach(e => {
                            e.controller.close();
                            clearInterval(e.keepAliveInterval);
                            e.keepAliveInterval = undefined;
                        });

                        nodeSseEvent.clients = [];
                    }
                }

                nodeSseEvent.handler(sseController);
            }

            // Allow avoiding a bug where the stream is closed.
            // Come from bun or chrome?
            //
            const timer = setInterval(() => {
                try { client.controller.enqueue(`event: echo\ndata: echo\n\n`); }
                catch {}
            }, 2000);

            const client: SseClient = {controller: streamController, me, keepAliveInterval: timer};
            me.client = client;

            nodeSseEvent.clients.push(client);

            const initialData = sseEvent.getWelcomeMessage();

            const encoder = new TextEncoder();
            streamController.enqueue(encoder.encode(`data: ${initialData}\n\n`));
        },

        cancel() {
            clearInterval(me.client!.keepAliveInterval);

            const nodeSseEvent = sseEvent as BunSseEvent;
            nodeSseEvent.clients = nodeSseEvent.clients.filter(e => e.me !== me);
        }
    });

    throw new SBPE_DirectSendThisResponseException(
        new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            }
        })
    );
}

//endregion

//region ServerInstanceProvider

export class BunJsServerInstanceBuilder implements ServerInstanceBuilder {
    private bunServer?: Bun.Server<unknown>;
    private serverOptions?: any;
    private serverRoutes: any = {};
    private readonly isReactHmrEnabled: boolean;

    private readonly pageToBuild: Record<string, string> = {};

    constructor(private readonly webSite: CoreWebSiteImpl) {
        this.isReactHmrEnabled = hasJopiDevUiFlag();
    }

    addRoute(verb: HttpMethod, path: string, route: WebSiteRouteInfos) {
        if (!this.serverRoutes[path]) {
            this.serverRoutes[path] = {};
        }

        const webSite = this.webSite;

        this.serverRoutes[path][verb] = (req: Bun.BunRequest, server: Bun.Server<unknown>) => {
            const urlInfos = new URL(req.url);
            return webSite.processRequest(route.handler, req.params, route, urlInfos, req, server);
        }
    }

    addWsRoute(path: string, handler: (ws: JopiWebSocket, infos: WebSocketConnectionInfos) => void) {
        //TODO
    }

    addSseEVent(path: string, eventInfos: SseEvent): void {
        eventInfos = {...eventInfos};

        this.addRoute("GET", path, {
            route: path,

            handler: async _ => {
                return onSseEvent(eventInfos);
            }
        });
    }

    async tryReturnFile(params: TryReturnFileParams): Promise<Response|undefined> {
        let stats = params.validationInfos.fileState;
        if (!stats) return undefined;

        if (stats?.isFile()) {
            const headers: any = {};
            if (params.contentEncoding) headers["content-encoding"] = params.contentEncoding;
            addBrowserCacheControlHeaders(headers, params);

            return new Response(Bun.file(params.filePath), {status: 200, headers});
        }

        return undefined;
    }

    addPage(path: string, pageKey: string, reactComponent: React.FC<any>, routeInfos: WebSiteRouteInfos) {
        if (this.isReactHmrEnabled) {
            this.pageToBuild[path] = pageKey;
            return;
        }

        routeInfos.handler = async (req) => {
            return await req.react_fromPage(pageKey, reactComponent);
        };

        routeInfos.handler = this.webSite.applyMiddlewares("GET", path, routeInfos.handler, true);
        this.addRoute("GET", path, routeInfos);
    }

    updateTlsCertificate(certificate: any) {
        this.serverOptions.tls = certificate;

        // Will reload without breaking the current connections.
        // @ts-ignore
        this.bunServer.reload(this.serverOptions);
    }

    async buildPage(path: string, pageKey: string): Promise<void> {
        const genDir = getBundleDirPath(this.webSite);
        const htmlFilePath = jk_fs.join(genDir, pageKey + ".html");

        if (!this.serverRoutes[path]) this.serverRoutes[path] = {};
        this.serverRoutes[path]["GET"] = (await import(htmlFilePath)).default;
    }

    async startServer(params: { port: number; tls: any }): Promise<CoreServer> {
        const options = {
            port: String(params.port),
            tls: params.tls,
            routes: this.serverRoutes,

            fetch: async (req: Request) => {
                const urlInfos = new URL(req.url);
                return await this.webSite.processRequest(undefined, {}, undefined, urlInfos, req, this.bunServer!);
            },

            development: this.isReactHmrEnabled && {
                // Enable browser hot reloading in development
                hmr: true,
                // Echo console logs from the browser to the server
                console: true,
            }
        };

        for (let path in this.pageToBuild) {
            let pageKey = this.pageToBuild[path];
            await this.buildPage(path, pageKey);
        }

        this.serverOptions = options;

        // @ts-ignore
        return this.bunServer = Bun.serve(options);
    }
}

//endregion