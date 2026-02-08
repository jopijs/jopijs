import type {CoreWebSite} from "./jopiCoreWebSite.ts";
import type {JopiRequest} from "./jopiRequest.ts";
import {sleep} from "jopi-toolkit/jk_timer";
import { getWebSiteConfig } from "../@coreconfig/index.ts";

interface RegisteredDataSource {
    securityUid: string;
    onCall: (req: JopiRequest) => Promise<Response>;
}

//region Server Actions

export function exposeServerAction(_name: string, securityUid: string, serverAction: Function, allowedRoles: string[]|undefined): string {
    toExpose.push({securityUid, onCall: async (req) => {
        if (allowedRoles && allowedRoles.length) {
            req.role_assertUserHasOneOfThisRoles(allowedRoles);
        }
        
        const reqData = await req.req_getBodyData<any>();
        const callParams = reqData.p;
        
        try {
            const functionCallRes = await serverAction.call(req, ...callParams);
            return req.res_jsonResponse({r: functionCallRes});
        } catch (err) {
            if (getWebSiteConfig().isProduction) {
                return req.res_jsonResponse({error: true});
            } else {
                if (err instanceof Error) {
                    return req.res_jsonResponse({
                        error: true,
                        errorMessage: err.message,
                        errorStack: err.stack
                    });
                } else {
                    return req.res_jsonResponse({
                        error: true,
                        errorMessage: String(err)
                    });
                }
            }
        }
    }});

    return "/_jopi/ds/" + securityUid;
}

//endregion

//region Server

const toExpose: RegisteredDataSource[] = [];

export function installDataSourcesServer(webSite: CoreWebSite) {
    for (let dsInfos of toExpose) {
        const onCall = dsInfos.onCall;

        webSite.onPOST("/_jopi/ds/" + dsInfos.securityUid, async req => {
            if (gHttpProxyReadPause) await sleep(gHttpProxyReadPause);
            return onCall(req)
        });
    }
}

/**
 * Allow forcing a pause before returning the data.
 */
let gHttpProxyReadPause: number = 0;

export function setHttpProxyReadPause(pauseMs: number) {
    gHttpProxyReadPause = pauseMs;
}

//endregion