import React from "react";
import {type HttpMethod, JopiRequest, WebSiteImpl, type WebSiteRouteInfos} from "jopijs";
import * as jk_crypto from "jopi-toolkit/jk_crypto";
import * as jk_events from "jopi-toolkit/jk_events";
import {PriorityLevel} from "jopi-toolkit/jk_tools";
import type {ExtractDirectoryInfosResult} from "../@linker";

export interface RouteAttributes {
    needRoles?: Record<string, string[]>;
    disableCache?: boolean;
    priority?: PriorityLevel;
    configFile?: string;
    dirInfos: ExtractDirectoryInfosResult;

    /**
     * When doing a catch-all, a slug can be set.
     * Here we store this slug name.
     *
     * Catch-all: /my/route/[...]
     * Catch-all with slug: /my/route/[...slugName]
     */
    catchAllSlug?: string;
}

type RouteHandler = (req: JopiRequest) => Promise<Response>;

function applyAttributes(infos: WebSiteRouteInfos, attributes: RouteAttributes, verb: string) {
    if (attributes.needRoles) {
        infos.requiredRoles = attributes.needRoles[verb];

        let allRoles = attributes.needRoles["all"];
        if (allRoles) infos.requiredRoles = infos.requiredRoles?.concat(allRoles);
    }

    if (attributes.disableCache) {
        infos.mustEnableAutomaticCache = false;
    }
}

interface RouteBindPageParams {
    route: string;
    attributes: RouteAttributes;
    filePath: string;
}

export async function routeBindPage(webSite: WebSiteImpl, reactComponent: React.FC<any>, params: RouteBindPageParams) {
    const pageKey = "page_" + jk_crypto.fastHash(params.route);
    let infos: WebSiteRouteInfos;

    // Catch all route?
    if (params.route.endsWith("*")) {
        infos = webSite.onPage(params.route, pageKey, reactComponent);
        applyAttributes(infos, params.attributes, "PAGE");
    }
    else
    {
        let specialPageHandler: (() => void) | undefined;

        if (params.route.startsWith("/error")) {
            switch (params.route) {
                case "/error404":
                    specialPageHandler = () => {
                        webSite.on404_NotFound(async (req) => {
                            return req.react_fromPage(pageKey, reactComponent);
                        });
                    }

                    break;

                case "/error500":
                    specialPageHandler = () => {
                        webSite.on500_Error(async (req) => {
                            return req.react_fromPage(pageKey, reactComponent);
                        });
                    }

                    break;

                case "/error401":
                    specialPageHandler = () => {
                        webSite.on401_Unauthorized(async (req) => {
                            return req.react_fromPage(pageKey, reactComponent);
                        });
                    }

                    break;
            }
        }

        // The page must not be visible if it's a special page.
        //
        if (specialPageHandler) {
            specialPageHandler();
        } else {
            //const REDIRECT_CODE = 301; // definitive
            const REDIRECT_CODE = 302; // temporary

            if (params.route === "/") {
                infos = webSite.onPage(params.route, pageKey, reactComponent);
            } else {
                if (webSite.mustRemoveTrailingSlashes) {
                    infos = webSite.onPage(params.route, pageKey, reactComponent);

                    // Note: with node.js, the router doesn't distinguish with and without /
                    // It's why the redirection is done internally.
                    //
                    webSite.onGET(params.route + "/", async (req) => {
                        req.urlInfos.pathname = req.urlInfos.pathname.slice(0, -1);
                        return Response.redirect(req.urlInfos.href, REDIRECT_CODE);
                    });
                } else {
                    infos = webSite.onPage(params.route + "/", pageKey, reactComponent);

                    // Note: with node.js, the router doesn't distinguish with and without /
                    // It's why the redirection is done internally.
                    //
                    webSite.onGET(params.route, async (req) => {
                        req.urlInfos.pathname += "/";
                        return Response.redirect(req.urlInfos.href, REDIRECT_CODE);
                    });
                }
            }

            applyAttributes(infos, params.attributes, "PAGE");
        }
    }

    await jk_events.sendAsyncEvent("@jopi.route.newPage", params);
}

interface RouteBindVerbParams extends RouteBindPageParams {
    verb: HttpMethod;
}

export async function routeBindVerb(webSite: WebSiteImpl, handler: RouteHandler, params: RouteBindVerbParams) {
    let infos = webSite.onVerb(params.verb, params.route, handler);
    applyAttributes(infos, params.attributes, params.verb);

    if (params.route!=="/") {
        infos = webSite.onVerb(params.verb, params.route + "/", handler);
        applyAttributes(infos, params.attributes, params.verb);
    }
}