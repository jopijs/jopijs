import http from "node:http";
import https from "node:https";
import {WebSocketServer} from "ws";
import * as jk_fs from "jopi-toolkit/jk_fs";
import fs from "node:fs";
import {addBrowserCacheControlHeaders, type TryReturnFileParams} from "../browserCacheControl.ts";

import type {
    CoreServer,
    ServerSocketAddress,
    SseEvent,
    SseEventController,
    StartServerOptions,
    WebSocketConnectionInfos
} from "../jopiServer.ts";
import type {
    HttpMethod,
    JopiWebSocket,
    JopiWsRouteHandler,
    CoreWebSite,
    WebSiteRouteInfos
} from "../jopiCoreWebSite.tsx";
import {SBPE_MustReturnWithoutResponseException} from "../jopiCoreWebSite.tsx";
import type {ServerInstanceBuilder} from "../serverInstanceBuilder.ts";
import {addRoute, createRouter, findRoute, type RouterContext} from "rou3";
import React from "react";
import {JopiRequestImpl} from "../jopiRequest.tsx";

class NodeServerInstance implements CoreServer {
    private readonly server: http.Server<typeof http.IncomingMessage, typeof http.ServerResponse>;

    constructor(private options: StartServerOptions) {
        let isHttps = options.tls !== undefined;

        async function handler(req: http.IncomingMessage, res: http.ServerResponse) {
            const headers = new Headers(req.headers as any);

            const method = req.method!;
            const body = (method == "GET" || method === "HEAD") ? undefined : jk_fs.nodeStreamToWebStream(req);

            // req doesn't allow knowing if we are http or https.
            // TODO BUG: https
            const webReq = new Request((isHttps ? "https://" : "http://") + req.headers.host! + req.url!, {
                body, headers, method,
                // @ts-ignore
                duplex: "half"
            });

            // @ts-ignore
            webReq.nodeJsReq = req;
            // @ts-ignore
            webReq.nodeJsRes = res;

            let webRes = reqFetch(webReq);
            if (webRes instanceof Promise) webRes = await webRes;
            if (webRes===undefined) return;

            let resHeaders = webRes.headers;
            let asJson: any = {};
            resHeaders.forEach((value, key) => asJson[key] = value);

            res.writeHead(webRes.status, asJson);

            if (webRes.body) {
                const asNodeStream = jk_fs.webStreamToNodeStream(webRes.body);
                asNodeStream.pipe(res);
            } else {
                res.end("");
            }
        }

        const reqFetch = options.fetch;

        if (options.tls) {
            let key = "", cert = "";

            if (options.tls instanceof Array) {
                for (const tls of options.tls) {
                    key += tls.key;
                    cert += tls.cert;
                }
            } else {
                key = options.tls.key;
                cert = options.tls.cert;
            }

            this.server = https.createServer({key, cert}, handler);
        }
        else {
            this.server = http.createServer(handler);
        }

        const onWebSocketConnection = options.onWebSocketConnection;

        if (onWebSocketConnection) {
            const wss = new WebSocketServer({ server: this.server });

            wss.on('connection', (ws, req) => {
                onWebSocketConnection(ws as unknown as WebSocket, {
                    url: "https://" + req.headers.host! + req.url!,
                    headers: new Headers(req.headers as any)
                });
            });
        }
    }

    requestIP(req: Request): ServerSocketAddress | null {
        // @ts-ignore
        let nodeReq: http.IncomingMessage = req.nodeJsReq;

        return {
            address: nodeReq.socket.remoteAddress!,
            port: nodeReq.socket.remotePort!,
            family: nodeReq.socket.remoteFamily as "IPv4" | "IPv6"
        };
    }

    async stop(_closeActiveConnections: boolean): Promise<void> {
        this.server.close();
    }

    timeout(_req: Request, _seconds: number): void {
        // Timeout is managed globally for all the requests.
    }

    start() {
        this.server.listen(this.options.port);
    }
}

//region SSE Events

interface NodeSseEvent extends SseEvent {
    clients: http.ServerResponse[];
}

export async function onSseEvent(sseEvent: SseEvent, rawReq: any): Promise<Response> {
    const req = rawReq.nodeJsReq as unknown as http.IncomingMessage;
    const res = rawReq.nodeJsRes as unknown as http.ServerResponse;

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    res.write(`data: ${sseEvent.getWelcomeMessage()}\n\n`);

    const nodeSseEvent = sseEvent as NodeSseEvent;

    if (!nodeSseEvent.clients) {
        nodeSseEvent.clients = [];

        let controller: SseEventController = {
            send(eventName: string, data: string) {
                let toSend = `event: ${eventName}\ndata: ${ JSON.stringify({message: data}) }\n\n`;
                nodeSseEvent.clients.forEach(res => { res.write(toSend) });
            },

            close() {
                nodeSseEvent.clients.forEach(res => {
                    if (!res.closed) {
                        res.end();
                    }
                });

                nodeSseEvent.clients = [];
            }
        }

        nodeSseEvent.handler(controller);
    }

    nodeSseEvent.clients.push(res);

    req.on('close', () => {
        nodeSseEvent.clients = nodeSseEvent.clients.filter(client => client !== res);
    });

    // Allow bubbling up.
    throw new SBPE_MustReturnWithoutResponseException();
}

//endregion

//region ServerInstanceProvider

export class NodeJsServerInstanceBuilder implements ServerInstanceBuilder {
    private readonly router: RouterContext<WebSiteRouteInfos> = createRouter<WebSiteRouteInfos>();
    private readonly wsRouter: RouterContext<JopiWsRouteHandler> = createRouter<JopiWsRouteHandler>();

    constructor(private readonly webSite: CoreWebSite) {
    }

    addRoute(verb: HttpMethod, path: string, routeInfos: WebSiteRouteInfos) {
        // Note: I have checked than the stored routeInfos is not a copy.
        addRoute(this.router, verb, path, routeInfos);
    }

    addWsRoute(path: string, handler: (ws: JopiWebSocket, infos: WebSocketConnectionInfos) => void) {
        addRoute(this.wsRouter, "ws", path, handler);
    }

    addSseEVent(path: string, handler: SseEvent): void {
        handler = {...handler};

        this.addRoute("GET", path, {
            route: path,

            handler: async req => {
                return onSseEvent(handler, req.coreRequest);
            }
        });
    }

    async startServer(params: { port: number; tls: any }): Promise<CoreServer> {
        async function doFetch(req: Request): Promise<Response|undefined> {
            const urlInfos = new URL(req.url);
            const matched = findRoute(router, req.method, urlInfos.pathname);

            if (matched) {
                return await webSite.processRequest(matched.data.handler, matched.params, matched.data, urlInfos, req, server!);
            } else {
                return await webSite.processRequest(undefined, {}, undefined, urlInfos, req, server!);
            }
        }

        const webSite = this.webSite;
        const router = this.router;

        const server = new NodeServerInstance({
            port: String(params.port),
            tls: params.tls,
            fetch: doFetch,

            onWebSocketConnection: (ws: WebSocket, infos: WebSocketConnectionInfos) => {
                //const urlInfos = new URL(infos.url);

                //const jws = new JopiWebSocket(this.webSite, server, ws);
                //TODO
                //webSite.declareNewWebSocketConnection(jws, infos, urlInfos);
            }
        });

        server.start();

        return server;
    }

    updateTlsCertificate(certificate: any) {
        // Not available for node.js
    }

    addPage(path: string, pageKey: string, reactComponent: React.FC<any>, routeInfos: WebSiteRouteInfos) {
        const mustRemoveTrailingSlashes = this.webSite.mustRemoveTrailingSlashes;

        routeInfos.handler = async (req) => {
            let path = req.req_urlInfos.pathname;

            if (path!=="/") {
                // Node.js router don't distinguish url ending with / and without.
                // It's why we must check it.
                //
                if (mustRemoveTrailingSlashes) {
                    if (path.endsWith("/")) {
                        req.req_urlInfos.pathname = req.req_urlInfos.pathname.slice(0, -1);
                        let redirectUrl = req.req_urlInfos.href;
                        return Response.redirect(redirectUrl, 302);
                    }
                } else {
                    if (!path.endsWith("/")) {
                        req.req_urlInfos.pathname += "/";
                        let redirectUrl = req.req_urlInfos.href;
                        return Response.redirect(redirectUrl, 302);
                    }
                }
            }

            return (req as JopiRequestImpl).react_fromPage(pageKey, reactComponent);
        };

        routeInfos.handler = this.webSite.applyMiddlewares("GET", path, routeInfos.handler, true);
        this.addRoute("GET", path, routeInfos);
    }

    async tryReturnFile(params: TryReturnFileParams): Promise<Response|undefined> {
        let stats = params.validationInfos.fileState;
        if (!stats) return undefined;

        // @ts-ignore
        const nodeJsRes = params.req.coreRequest.nodeJsRes as http.ServerResponse;

        const headers: any = {
            "content-type": jk_fs.getMimeTypeFromName(params.filePath),
            "content-length": stats.size
        };

        if (params.contentEncoding) {
            headers["content-encoding"] = params.contentEncoding;
        }

        addBrowserCacheControlHeaders(headers, params);

        // Envoyer les headers
        nodeJsRes.writeHead(200, headers);

        const readStream = fs.createReadStream(params.filePath);
        readStream.pipe(nodeJsRes);

        throw new SBPE_MustReturnWithoutResponseException();
    }
}

//endregion