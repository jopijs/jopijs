import type {IActionContext, JDataReadParams, JDataTable} from "jopi-toolkit/jk_data";
import type {CoreWebSite} from "./jopiCoreWebSite.ts";
import type {JopiRequest} from "./jopiRequest.ts";
import {sleep} from "jopi-toolkit/jk_timer";
import type {PageDataProviderData} from "jopijs/ui";
import { getWebSiteConfig } from "../@coreconfig/index.ts";

interface RegisteredDataSource {
    securityUid: string;
    onCall: (req: JopiRequest) => Promise<Response>;
}

//region Data Table

// noinspection JSUnusedGlobalSymbols
/**
 * Expose a data table to the network.
 * Warning: if mainly called by generated code.
 */
export function exposeDataSource_Table(_name: string, securityUid: string, dataTable: JDataTable, permissions: Record<string, string[]>) {
    toExpose.push({
        securityUid,

        onCall: async (req) => {
            let reqData = await req.req_getBodyData();

            if (reqData.action) {
                // Each action must check his roles.
                // But if we can't read the data, we can't triger actions.
                //
                if (permissions.READ) {
                    req.role_assertUserHasOneOfThisRoles(permissions.READ);
                }

                const res = await dataTable.executeAction?.(reqData.rows, reqData.action, req as unknown as IActionContext);

                if (res) {
                    return req.res_jsonResponse(res);
                } else {
                    return req.res_jsonResponse({isOk: true});
                }
            }
            else if (reqData.read) {
                if (permissions.READ) {
                    req.role_assertUserHasOneOfThisRoles(permissions.READ);
                }

                let res = await dataTable.read(reqData.read);
                return req.res_jsonResponse(res);
            }

            return req.res_returnError400_BadRequest();
        }
    });
}

//endregion

//region Page data

export interface JopiPageDataProvider {
    getDataForCache(params: GetDataForCacheParams): Promise<PageDataProviderData>;
    getRefreshedData?(params: GetRefreshedDataParams): Promise<PageDataProviderData>;
}

export interface GetDataForCacheParams {
    req: JopiRequest;
}

export interface GetRefreshedDataParams {
    req: JopiRequest;
    seed: any;
    isFromBrowser?: boolean;
}

export function exposeDataSource_PageData(_route: string, securityUid: string, dataProvider: JopiPageDataProvider, allowedRoles: string[]|undefined): string {
    toExpose.push({securityUid, onCall: async (req) => {
        if (allowedRoles && allowedRoles.length) {
            req.role_assertUserHasOneOfThisRoles(allowedRoles);
        }
        
        const reqData = await req.req_getBodyData<any>();
        const res = await dataProvider.getRefreshedData!.call(dataProvider, {req, seed: reqData.seed, isFromBrowser: true});
        return req.res_jsonResponse(res);
    }});

    return "/_jopi/ds/" + securityUid;
}

//endregion

//region Server Actions

export function exposeServerAction(_name: string, securityUid: string, serverAction: Function, allowedRoles: string[]|undefined): string {
    toExpose.push({securityUid, onCall: async (req) => {
        if (allowedRoles && allowedRoles.length) {
            req.role_assertUserHasOneOfThisRoles(allowedRoles);
        }
        
        debugger;
        const reqData = await req.req_getBodyData<any>();
        const callParams = reqData.p;
        
        try {
            const functionCallRes = await serverAction.call(serverAction, ...callParams);
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