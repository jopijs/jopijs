import type {JopiPageDataProvider} from "jopijs";
import {declareLinkerError} from "jopijs/linker";
import * as jk_crypto from "jopi-toolkit/jk_crypto";
import * as jk_fs from "jopi-toolkit/jk_fs";
import {exposeDataSource_PageData} from "jopijs";

export function setPageDataProvider(webSite: any, route: string, allowedRoles: string[], provider: JopiPageDataProvider, filePath: string) {
    if (!provider.getRefreshedData && !provider.getDataForCache) {
        filePath = jk_fs.resolve(filePath);
        throw declareLinkerError(`Page data : Invalid data provider for route ${route}`, filePath);
    }

    // Don't allow calling the data provider if not allowed.
    //
    if (allowedRoles && (allowedRoles.length > 0)) {
        const originalGetDataForCache = provider.getDataForCache;
        //
        provider.getDataForCache = async function (params) {
            params.req.role_assertUserHasOneOfThisRoles(allowedRoles);
            return originalGetDataForCache.call(this, params);
        };

        if (provider.getRefreshedData) {
            const originalGetRefreshedData = provider.getRefreshedData;
            //
            provider.getRefreshedData = async function (params) {
                params.req.role_assertUserHasOneOfThisRoles(allowedRoles);
                return originalGetRefreshedData.call(this, params);
            };
        }
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
        const pageDataKey = jk_crypto.md5(route + "todo_allowing_configuring_this_salt");
        routeInfos.pageDataParams.url = exposeDataSource_PageData(route, pageDataKey, provider, allowedRoles);
    }
}