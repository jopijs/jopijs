import { type ValueWithPriority } from "jopi-toolkit/jk_tools";
import { JopiRequest } from "./jopiRequest.ts";
import type { JopiMiddleware, JopiPostMiddleware, JopiWebSocket } from "./jopiCoreWebSite.ts";
import type { JopiPageDataProvider } from "./dataSources.ts";
import type { SearchParamFilterFunction } from "./searchParamFilter.ts";
import type { WebSocketConnectionInfos } from "./jopiServer.ts";

export type RouteHandler = (req: JopiRequest) => Promise<Response>;

/** Function signature for handling a standard HTTP route. */
export type JopiRouteHandler = (req: JopiRequest) => Promise<Response>;

/** Function signature for handling a WebSocket connection. */
export type JopiWsRouteHandler = (ws: JopiWebSocket, infos: WebSocketConnectionInfos) => void;

/** Function signature for handling HTTP errors (404, 500, etc.). */
export type JopiErrorHandler = (req: JopiRequest, error?: Error | string) => Response | Promise<Response>;

/**
 * Allows to select routes.
 */
export interface RouteSelector {
    /**
     * Define the path pattern.
     * - "/": matches everything
     * - "/hello": matches "/hello" and sub-paths like "/hello/world" (but NOT "/helloworld")
     * - "/hello/": matches sub-paths like "/hello/world" (but NOT "/hello")
     */
    fromPath?: string;

    /**
     * Define the list of paths to include.
     */
    include?: string[];

    /**
     * Define the list of paths to exclude.
     */
    exclude?: string[];

    /**
     * Allow testing if a path is accepted or not.
     * @param handler
     */
    test?: (routePath: string) => boolean;
}

/**
 * Tests if a path matches the route selector.
 */
export function testRoutePath(path: string, routeSelector: RouteSelector): boolean {
    // 1. Security First: Exclude (Veto)
    // If explicitly excluded, reject immediately.
    if (routeSelector.exclude && routeSelector.exclude.includes(path)) {
        return false;
    }

    // 2. Authorize via Explicit Include
    if (routeSelector.include && routeSelector.include.includes(path)) {
        return true;
    }

    // 3. Authorize via Path Pattern
    if (routeSelector.fromPath) {
        const fp = routeSelector.fromPath;

        if (fp.endsWith("/")) {
            // If ends with /, we match sub-paths
            if (path.startsWith(fp)) return true;
        } else {
            // Exact match or sub-path with /
            if ((path === fp) || path.startsWith(fp + "/")) return true;
        }
    }

    // 4. Authorize via Custom Test
    // If the test function returns true, we authorize.
    if (routeSelector.test && routeSelector.test(path)) {
        return true;
    }

    // 5. Default Deny
    // If no rule authorized the route, it is rejected.
    return false;
}

export interface WebSiteRouteInfos {
    route: string;
    handler: RouteHandler;

    requiredRoles?: string[];

    middlewares?: ValueWithPriority<JopiMiddleware>[];
    postMiddlewares?: ValueWithPriority<JopiPostMiddleware>[];

    /**
     * If defined, then this is a catch-all slug.
     * Example: for the route /user/[...path] then the slug is "path".
     */
    catchAllSlug?: string;

    /**
     * Data provider for the page.
     */
    pageDataParams?: {
        provider: JopiPageDataProvider;
        roles?: string[];
        url?: string;
    };

    /**
     * Define a filter to use to sanitize the search params of the url.
     */
    searchParamFilter?: SearchParamFilterFunction;

    mustEnableAutomaticCache?: boolean;

    /**
     * Define a function which is called to read the cache.
     * This allows replacing the default cache reading behavior.
     */
    readCacheEntry?(req: JopiRequest): Promise<Response | undefined>;

    afterGetFromCache?: (req: JopiRequest, res: Response) => Promise<Response | undefined | void>;
    beforeAddToCache?: (req: JopiRequest, res: Response) => Promise<Response | undefined | void>;
    beforeCheckingCache?: (req: JopiRequest) => Promise<Response | undefined | void>;
    ifNotInCache?: (req: JopiRequest, isPage: boolean) => void;
}
