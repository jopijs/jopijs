import type {JNamedTableReader, JNamedTableReader_ReadParams, JTableReader} from "jopi-toolkit/jk_data";
import type {CoreWebSite} from "./jopiCoreWebSite.ts";
import type {JopiRequest} from "./jopiRequest.ts";
import {sleep} from "jopi-toolkit/jk_timer";
import type {PageDataProviderData} from "jopijs/ui";

interface RegisteredDataSource {
    securityUid: string;
    onCall: (req: JopiRequest) => Promise<Response>;
}

//region Data Table

// noinspection JSUnusedGlobalSymbols
/**
 * Expose a data source to the network.
 * Warning: if mainly called by generated code.
 */
export function exposeDataSource_Table(_name: string, securityUid: string, dataSource: JTableReader, permissions: Record<string, string[]>) {
    toExpose.push({
        securityUid,

        onCall: async (req) => {
            let reqData = await req.req_getBodyData<{
                dsName: string;
                read?: JNamedTableReader_ReadParams;
            }>();

            if (reqData.read) {
                let requiredRoles = permissions.READ;
                if (requiredRoles) req.role_assertUserHasOneOfThisRoles(requiredRoles);

                let res = await dataSource.read(reqData.read);
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

export function exposeDataSource_PageData(route: string, securityUid: string, dataProvider: JopiPageDataProvider, allowedRoles: string[]|undefined): string {
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