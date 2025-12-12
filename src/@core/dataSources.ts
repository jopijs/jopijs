import type {JTableDs, JTableDs_ReadParams} from "jopi-toolkit/jk_data";
import type {WebSite} from "./jopiWebSite";
import type {JopiRequest} from "./jopiRequest";
import {sleep} from "jopi-toolkit/jk_timer";

interface RegisteredDataSource {
    name: string;
    securityUid: string;
    dataSource: JTableDs;
    permissions: Record<string, string[]>;
}

const toExpose: Record<string, RegisteredDataSource> = {};

// noinspection JSUnusedGlobalSymbols
/**
 * Expose a data source to the network.
 * Warning: if mainly called by generated code.
 */
export function exposeDataSource_Table(name: string, securityUid: string, dataSource: JTableDs, permissions: Record<string, string[]>) {
    toExpose[name] = {name, securityUid, dataSource, permissions};
}

export function installDataSourcesServer(webSite: WebSite) {
    for (let key in toExpose) {
        const dsInfos = toExpose[key];
        webSite.onPOST("/_jopi/ds/" + dsInfos.securityUid, req => onDsTableCall_POST(req, dsInfos));
    }
}

interface HttpRequestParams {
    dsName: string;
    read?: JTableDs_ReadParams;
}

async function onDsTableCall_POST(req: JopiRequest, dsInfos: RegisteredDataSource): Promise<Response> {
    let reqData = await req.req_getBodyData<HttpRequestParams>();

    if (reqData.read) {
        let requiredRoles = dsInfos.permissions.READ;
        if (requiredRoles) req.role_assertUserHasRoles(requiredRoles);

        if (gHttpProxyReadPause) await sleep(gHttpProxyReadPause);
        let res = await dsInfos.dataSource.read(reqData.read);
        return req.res_jsonResponse(res);
    }

    return req.res_returnError400_BadRequest();
}

/**
 * Allow forcing a pause before returning the data.
 */
let gHttpProxyReadPause: number = 0;

export function setHttpProxyReadPause(pauseMs: number) {
    gHttpProxyReadPause = pauseMs;
}