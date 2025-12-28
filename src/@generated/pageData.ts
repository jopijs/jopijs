import type {JopiPageDataProvider} from "jopijs";
import {declareLinkerError} from "jopijs/linker";
import * as jk_crypto from "jopi-toolkit/jk_crypto";
import {exposeDataSource_PageData} from "../@core";

export function setPageDataProvider(webSite: any, route: string, allowedRoles: string[], provider: JopiPageDataProvider, filePath: string) {
    if (!provider.getRefreshedData && !provider.getDataForCache) {
        throw declareLinkerError(`Page data : Invalid data provider for route ${route}`, filePath);
    }

    let routeInfos = webSite.getRouteInfos("GET", route);

    if (!routeInfos) {
        throw declareLinkerError(`Page data : the route route doesn't exist ${route}`, filePath);
    }

    routeInfos.pageDataParams = {
        provider, roles: allowedRoles
    };

    if (provider.getRefreshedData) {
        //TODO: Allowing configuring this salt.
        const pageDataKey = jk_crypto.md5(route + "todo_allowing_configuring_this_salt");
        routeInfos.pageDataParams.url = exposeDataSource_PageData(route, pageDataKey, provider, allowedRoles);
    }
}