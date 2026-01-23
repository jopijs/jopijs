import type {JopiPageDataProvider} from "jopijs";
import {declareLinkerError} from "jopijs/linker";
import * as jk_fs from "jopi-toolkit/jk_fs";
import {exposeDataSource_PageData} from "jopijs";
import { calcCryptedUrl } from "./tools.ts";

export function setPageDataProvider(webSite: any, route: string, allowedRoles: string[], provider: JopiPageDataProvider, filePath: string) {
    if (!provider.getRefreshedData && !provider.getDataForCache) {
        filePath = jk_fs.resolve(filePath);
        throw declareLinkerError(`Page data : Invalid data provider for route ${route}`, filePath);
    }

    let routeInfos = webSite.getRouteInfos("GET", route);

    if (!routeInfos) {
        filePath = jk_fs.resolve(filePath);
        throw declareLinkerError(`Page data : the route route doesn't exist ${route}`, filePath);
    }

    routeInfos.pageDataParams = {
        provider, roles: allowedRoles
    };

    if (provider.getRefreshedData) {
        //TODO: Allowing configuring this salt.
        const pageDataKey = calcCryptedUrl(route);

        // Note: role security check is done into this http proxy.
        routeInfos.pageDataParams.url = exposeDataSource_PageData(route, pageDataKey, provider, allowedRoles);
    }
}