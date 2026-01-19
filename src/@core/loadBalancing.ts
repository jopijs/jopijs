import type {ServerFetch} from "./serverFetch.ts";
import {type SendingBody} from "./jopiCoreWebSite.ts";
import {JopiRequest} from "./jopiRequest.js";
import * as jk_timer from "jopi-toolkit/jk_timer";

const newInterval = jk_timer.newInterval;

export class LoadBalancer {
    private readonly servers: Server[] = [];
    private totalWeight = 0;
    private head?: Server;
    private tail?: Server;
    private lastUsedServer?: Server;
    private isTimerStarted = false;

    addServer<T>(server: ServerFetch<T>, weight?: number) {
        if (server.loadBalancer) throw Error("Server already added to a load balancer");
        server.loadBalancer = this;

        if (!weight) weight = 1;
        else if (weight>1) weight = 1;
        else if (weight<0) weight = 0;

        const lbServer = {fetcher: server, weight} as Server;

        if (!this.head) this.head = lbServer;
        lbServer.next = this.head;

        if (this.tail) this.tail.next = lbServer;
        this.tail = lbServer;

        this.servers.push(lbServer);
        this.totalWeight += lbServer.weight;
    }

    replaceServer<T>(oldServer: ServerFetch<T>, newServer: ServerFetch<T>, weight?: number) {
        const lbServer = this.servers.find(s => s.fetcher===oldServer);
        if (!lbServer) return;

        newServer.loadBalancer = this;

        lbServer.isServerDown = false;
        lbServer.fetcher = newServer as ServerFetch<unknown>;
        if (weight!==undefined) lbServer.weight = weight;
    }

    private selectServer(): Server|undefined {
        if (this.servers.length === 0) return undefined;

        const lastUsedServer = this.lastUsedServer! || this.tail!;
        let cursor = lastUsedServer.next;
        let round = 0;

        let random = Math.random();

        while (true) {
            if (cursor===lastUsedServer) {
                round++;

                if (round===1) {
                    // If we are here, it's mean we have tested all the server but no one is ok.
                    // Then reduce the random value to 0 to include a server with weight 0.
                    //
                    random = 0;
                } else if (round===2) {
                    // No server despite that?
                    return undefined;
                }
            }

            if (cursor.isServerDown) continue;
            if (random < cursor.weight) break;

            cursor = cursor.next;
        }

        this.lastUsedServer = cursor;
        return cursor;
    }

    async fetch(method: string, url: URL, body?: SendingBody, headers?: any): Promise<Response> {
        const server = this.selectServer();
        if (!server) return new Response("", {status: 521});

        const res = await server.fetcher.fetch(method, url, body, headers);

        if (res.status===521) {
            this.declareServerDown(server);

            // We retry with the next server.
            // It's ok since the body isn't consumed yey.
            return this.fetch(method, url, body, headers);
        }

        return res;
    }

    async directProxy(serverRequest: JopiRequest): Promise<Response> {
        const server = this.selectServer();
        if (!server) return new Response("", {status: 521});

        const res = await server.fetcher.directProxy(serverRequest);

        if (res.status===521) {
            this.declareServerDown(server);
        }

        return res;
    }

    private declareServerDown(server: Server) {
        if (server.isServerDown) return;
        server.isServerDown = true;

        // Will try to restart the server automatically.
        //
        if (!this.isTimerStarted) {
            newInterval(2000, () => this.onTimer())
        }
    }

    onTimer() {
        let hasServerDown = false;

        this.servers.forEach(async server => {
            if (!server.isServerDown) return;

            if (await server.fetcher.checkIfServerOk()) {
                server.isServerDown = false;
            } else {
                hasServerDown = true;
            }
        });

        if (!hasServerDown) {
            this.isTimerStarted = false;

            // Returning false will stop the timer.
            return false;
        }

        // The timer will continue.
        return true;
    }
}

interface Server {
    fetcher: ServerFetch<unknown>;
    weight: number;
    next: Server;
    isServerDown?: boolean;
}
