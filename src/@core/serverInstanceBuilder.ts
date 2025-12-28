import type {CoreServer, SseEvent, WebSocketConnectionInfos} from "./jopiServer.ts";
import {isBunJS} from "jopi-toolkit/jk_what";
import {BunJsServerInstanceBuilder} from "./serverImpl/server_bunjs.tsx";
import {NodeJsServerInstanceBuilder} from "./serverImpl/server_nodejs.ts";
import {
    type HttpMethod,
    JopiWebSocket,
    CoreWebSite,
    type WebSiteRouteInfos
} from "./jopiCoreWebSite.tsx";
import React from "react";
import type {TryReturnFileParams} from "./browserCacheControl.ts";

export interface ServerInstanceBuilder {
    addRoute(verb: HttpMethod, path: string, routeInfos: WebSiteRouteInfos): void;

    addWsRoute(path: string, handler: (ws: JopiWebSocket, infos: WebSocketConnectionInfos) => void): void;

    addSseEVent(path: string, handler: SseEvent): void;

    startServer(params: { port: number; tls: any }): Promise<CoreServer>;

    updateTlsCertificate(certificate: any): void;

    addPage(path: string, pageKey: string, reactComponent: React.FC<any>, routeInfos: WebSiteRouteInfos): void;

    tryReturnFile(params: TryReturnFileParams): Promise<Response|undefined>;
}

export function getNewServerInstanceBuilder(webSite: CoreWebSite): ServerInstanceBuilder {
    if (isBunJS) {
        return new BunJsServerInstanceBuilder(webSite);
    } else {
        return new NodeJsServerInstanceBuilder(webSite);
    }
}
