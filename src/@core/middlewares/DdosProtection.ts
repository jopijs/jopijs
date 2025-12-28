import {JopiRequest} from "../jopiRequest.tsx";
import type {JopiMiddleware} from "../jopiCoreWebSite.tsx";
import {getServerStartOptions} from "../jopiServer.ts";
import * as jk_tools from "jopi-toolkit/jk_tools";
import * as jk_timer from "jopi-toolkit/jk_timer";

const newInterval = jk_timer.newInterval;
const applyDefaults = jk_tools.applyDefaults;

// slowhttptest -c 1000 -H -i 10 -r 200 -t GET -u http://my-server -x 24 -p 3

export interface DdosProtectionOptions {
    /**
     * If the request takes more than n-milliseconds to send his headers, then we reject this request.
     * Warning: this value is global to all websites. Setting it will affect all of them.
     * Default: 500 ms.
     */
    sendHeadersTimeout_ms?: number;

    /**
     * Delay in millisecondes after which the request timeout.
     * Default: 60 seconds.
     */
    requestTimeout_sec?: number;

    /**
     * We will limit the number of calls allowed during an interval.
     * Here it's the size of this interval in milliseconds.
     * Default is 1000 ms (one second).
     *
     * The default behaviors are that you can do more than 10 calls to the same second with the same IP.
     * If you need an exception for an IP, use onBlackRequest
     */
    timeInterval_ms?: number;

    /**
     * We will limit the number of calls allowed during an interval.
     * Here's the number of connections allowed during this interval of time.
     * Default is 10.
     *
     * The default behaviors are that you can do more than 10 calls to the same second with the same IP.
     * If you need an exception for an IP, use onBlackRequest
     */
    connectionLimit?: number;

    /**
     * Is call if a request is detected as an anomaly.
     */
    onBlackRequest?: JopiMiddleware;
}

let gGlobalBlackRequestListener: JopiMiddleware|undefined;

/**
 * Allow setting a listener which is called when a black request is detected.
 * It'd mainly used to add his IP to a banned IP list.
 */
export function setGlobalBlackRequestListener(listener: JopiMiddleware) {
    gGlobalBlackRequestListener = listener;
}

export default function(options?: DdosProtectionOptions): JopiMiddleware {
    options = applyDefaults<DdosProtectionOptions>(options, {
        sendHeadersTimeout_ms: 500,
        requestTimeout_sec: 60,

        timeInterval_ms: 1000,
        connectionLimit: 10,

        onBlackRequest: () => {
            return new Response("Too many request", { status: 429 });
        }
    });

    // Here it's a common value for all servers.
    getServerStartOptions().timeout = options.sendHeadersTimeout_ms!;

    const mapConnectionsPerIP = new Map<String, number>;
    const connectionLimit = options.connectionLimit!;

    let mustReset = false;

    // The values here are reset after a delay.
    //
    newInterval(options.timeInterval_ms!, () => {
        if (mustReset) {
            mapConnectionsPerIP.clear();
        }
    });

    return (req: JopiRequest) => {
        // If we are here, it's mean the request take less than 1 second to send his headers.
        // It's why we can extend the time-out delay (60 secondes).
        //
        req.req_extendTimeout_sec(options.requestTimeout_sec!);

        // > Check how many-time this request has reached the server recently.

        const clientIP = req.req_callerIP?.address;

        if (clientIP) {
            const currentConnections = (mapConnectionsPerIP.get(clientIP) || 0) + 1;

            if (currentConnections > connectionLimit) {
                if (gGlobalBlackRequestListener) {
                    const res = gGlobalBlackRequestListener(req);
                    if (res!==null) return res;
                }

                return options.onBlackRequest!(req);
            }

            mapConnectionsPerIP.set(clientIP, currentConnections);
            mustReset = true;
        }

        // Allow continuing to the next middleware.
        return null;
    }
};