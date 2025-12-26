import type {JopiMiddleware, JopiPostMiddleware, WebSiteImpl} from "./jopiWebSite.tsx";
import type {JopiRequest} from "./jopiRequest.tsx";
import {PriorityLevel} from "jopi-toolkit/jk_tools";
import type {MenuItemForExtraPageParams} from "jopijs/ui";

export class RouteConfig {
    constructor(private readonly webSite: WebSiteImpl,
                private readonly route: string,
                private requiredRoles: string[]|undefined) {

        this.onPage = new RouteConfig_OnPage(this.webSite, this.route, "GET");
        this.onGET = new RouteConfig_Core(this.webSite, this.route, "GET");
        this.onPOST = new RouteConfig_Core(this.webSite, this.route, "POST");
        this.onPUT = new RouteConfig_Core(this.webSite, this.route, "PUT");
        this.onDELETE = new RouteConfig_Core(this.webSite, this.route, "DELETE");
        this.onHEAD = new RouteConfig_Core(this.webSite, this.route, "HEAD");
        this.onPATCH = new RouteConfig_Core(this.webSite, this.route, "PATCH");
        this.onOPTIONS = new RouteConfig_Core(this.webSite, this.route, "OPTIONS");
        this.onALL = new RouteConfig_Core(this.webSite, this.route, "*");
    }

    public readonly onPage: RouteConfig_OnPage;
    public readonly onGET: RouteConfig_Core;
    public readonly onPOST: RouteConfig_Core;
    public readonly onPUT: RouteConfig_Core;
    public readonly onDELETE: RouteConfig_Core;
    public readonly onHEAD: RouteConfig_Core;
    public readonly onPATCH: RouteConfig_Core;
    public readonly onOPTIONS: RouteConfig_Core;
    public readonly onALL: RouteConfig_Core;

    menu_addToMenu(menuName: string, keys: string[], menuItem?: MenuItemForRouteConfig) {
        if (!menuItem) menuItem = {};

        const entry: MenuItemForExtraPageParams = {
            ...menuItem, menuName, keys,

            url: this.route,
            roles: this.requiredRoles
        };

        this.webSite.addMenuEntry(entry);

        return {
            ignoreRoles() {
                entry.roles = undefined;
            },

            requireRoles(...roles: string[]) {
                entry.roles = roles;
            }
        }
    }

    menu_addToLeftMenu(keys: string[], menuItem?: MenuItemForRouteConfig) {
        return this.menu_addToMenu("layout.left", keys, menuItem);
    }

    menu_addToRightMenu(keys: string[], menuItem?: MenuItemForRouteConfig) {
        return this.menu_addToMenu("layout.right", keys, menuItem);
    }

    menu_addToTopMenu(keys: string[], menuItem?: MenuItemForRouteConfig) {
        return this.menu_addToMenu("layout.top", keys, menuItem);
    }
}

class RouteConfig_Core {
    constructor(protected readonly webSite: WebSiteImpl,
                protected readonly route: string,
                protected readonly method: string) {
    }

    add_middleware(middleware: JopiMiddleware, priority: PriorityLevel = PriorityLevel.default) {
        let routeInfos = this.webSite.getRouteInfos(this.method, this.route);
        if (!routeInfos) return;

        if (!routeInfos.middlewares) routeInfos.middlewares = [];
        routeInfos.middlewares.push({priority, value: middleware});
    }

    add_postMiddleware(middleware: JopiPostMiddleware, priority: PriorityLevel = PriorityLevel.default) {
        let routeInfos = this.webSite.getRouteInfos(this.method, this.route);
        if (!routeInfos) return;

        if (!routeInfos.postMiddlewares) routeInfos.postMiddlewares = [];
        routeInfos.postMiddlewares.push({priority, value: middleware});
    }

    add_requiredRole(...roles: string[]) {
        let routeInfos = this.webSite.getRouteInfos(this.method, this.route);
        if (!routeInfos) return;

        if (!routeInfos.requiredRoles) routeInfos.requiredRoles = [];
        routeInfos?.requiredRoles.push(...roles);
    }
}

class RouteConfig_OnPage extends RouteConfig_Core {
    cache_disableAutomaticCache() {
        let routeInfos = this.webSite.getRouteInfos("GET", this.route);
        if (!routeInfos) return;

        routeInfos.mustEnableAutomaticCache = false;
    }

    /**
     * Define a function which is called when the response is get from the cache.
     * If a value is returned, then this value is used as the new value,
     * allowing to replace what comes from the cache.
     * @param handler
     */
    cache_afterGetFromCache(handler: (req: JopiRequest, res: Response) => Promise<Response | undefined | void>) {
        let routeInfos = this.webSite.getRouteInfos("GET", this.route);
        if (!routeInfos) return;

        routeInfos.afterGetFromCache = handler;
    }

    /**
     * Defines a function which can alter the response to save into the cache or avoid cache adding.
     * If returns a response: this response will be added into the cache.
     * If returns undefined: will not add the response into the cache.
     */
    cache_beforeAddToCache(handler: (req: JopiRequest, res: Response) => Promise<Response | undefined | void>) {
        let routeInfos = this.webSite.getRouteInfos("GET", this.route);
        if (!routeInfos) return;

        routeInfos.beforeAddToCache = handler;
    }

    /**
     * Define a function which is called before checking the cache.
     * This allows doing some checking, and if needed, it can return
     * a response and bypass the request cycle.
     */
    cache_beforeCheckingCache(handler: (req: JopiRequest) => Promise<Response | undefined | void>) {
        let routeInfos = this.webSite.getRouteInfos("GET", this.route);
        if (!routeInfos) return;

        routeInfos.beforeCheckingCache = handler;
    }

    /**
     * Define a function which is called when the response is not in the cache.
     */
    cache_ifNotInCache(handler: (req: JopiRequest) => void): void {
        let routeInfos = this.webSite.getRouteInfos("GET", this.route);
        if (!routeInfos) return;

        routeInfos.ifNotInCache = handler;
    }
}

interface MenuItemForRouteConfig {
    title?: string,
    icon?: string,
    priority?: number
}