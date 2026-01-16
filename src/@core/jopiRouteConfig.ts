import type { JopiMiddleware, JopiPostMiddleware, CoreWebSite } from "./jopiCoreWebSite.tsx";
import type { JopiRequest } from "./jopiRequest.tsx";
import { PriorityLevel } from "jopi-toolkit/jk_tools";
import type { MenuItemForExtraPageParams } from "jopijs/ui";

/**
 * Provides a fluent API to configure a specific route programmatically.
 * Allows adding middlewares, enforcing roles, and managing menu integration
 * for different HTTP methods on the same route.
 */
export class JopiRouteConfig {
    constructor(private readonly webSite: CoreWebSite,
        private readonly route: string,
        private requiredRoles: string[] | undefined) {

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

    /** Configuration for GET requests when they correspond to a React page. */
    public readonly onPage: RouteConfig_OnPage;
    /** Configuration for GET requests. */
    public readonly onGET: RouteConfig_Core;
    /** Configuration for POST requests. */
    public readonly onPOST: RouteConfig_Core;
    /** Configuration for PUT requests. */
    public readonly onPUT: RouteConfig_Core;
    /** Configuration for DELETE requests. */
    public readonly onDELETE: RouteConfig_Core;
    /** Configuration for HEAD requests. */
    public readonly onHEAD: RouteConfig_Core;
    /** Configuration for PATCH requests. */
    public readonly onPATCH: RouteConfig_Core;
    /** Configuration for OPTIONS requests. */
    public readonly onOPTIONS: RouteConfig_Core;
    /** Configuration for all HTTP methods. */
    public readonly onALL: RouteConfig_Core;

    /**
     * Registers this route as a menu entry in the website's navigation system.
     * @param menuName The name of the menu (e.g., "layout.top").
     * @param keys Translation keys or title strings for the menu label.
     * @param menuItem Additional menu metadata (icon, priority).
     */
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

    /** Shortcut to add this route to the left sidebar menu. */
    menu_addToLeftMenu(keys: string[], menuItem?: MenuItemForRouteConfig) {
        return this.menu_addToMenu("layout.left", keys, menuItem);
    }

    /** Shortcut to add this route to the right sidebar menu. */
    menu_addToRightMenu(keys: string[], menuItem?: MenuItemForRouteConfig) {
        return this.menu_addToMenu("layout.right", keys, menuItem);
    }

    /** Shortcut to add this route to the top navigation menu. */
    menu_addToTopMenu(keys: string[], menuItem?: MenuItemForRouteConfig) {
        return this.menu_addToMenu("layout.top", keys, menuItem);
    }
}

/**
 * Base configuration class for a route and a specific HTTP method.
 */
class RouteConfig_Core {
    constructor(protected readonly webSite: CoreWebSite,
        protected readonly route: string,
        protected readonly method: string) {
    }

    /**
     * Adds a middleware to this route.
     * Middlewares are executed before the final request handler.
     * @param middleware The middleware function.
     * @param priority Execution priority (default is PriorityLevel.default).
     */
    add_middleware(middleware: JopiMiddleware, priority: PriorityLevel = PriorityLevel.default) {
        let routeInfos = this.webSite.getRouteInfos(this.method, this.route);
        if (!routeInfos) return;

        if (!routeInfos.middlewares) routeInfos.middlewares = [];
        routeInfos.middlewares.push({ priority, value: middleware });
    }

    /**
     * Adds a post-process middleware to this route.
     * Post-middlewares are executed after the request handler has generated a response.
     * @param middleware The post-middleware function.
     * @param priority Execution priority.
     */
    add_postMiddleware(middleware: JopiPostMiddleware, priority: PriorityLevel = PriorityLevel.default) {
        let routeInfos = this.webSite.getRouteInfos(this.method, this.route);
        if (!routeInfos) return;

        if (!routeInfos.postMiddlewares) routeInfos.postMiddlewares = [];
        routeInfos.postMiddlewares.push({ priority, value: middleware });
    }

    /**
     * Enforces role-based access control for this specific route and method.
     * @param roles List of roles that are allowed to access this route.
     */
    add_requiredRole(...roles: string[]) {
        let routeInfos = this.webSite.getRouteInfos(this.method, this.route);
        if (!routeInfos) return;

        if (!routeInfos.requiredRoles) routeInfos.requiredRoles = [];
        routeInfos?.requiredRoles.push(...roles);
    }
}

/**
 * Specialized configuration for page routes (GET), providing hooks for cache management.
 */
class RouteConfig_OnPage extends RouteConfig_Core {
    /**
     * Disables the automatic cache engine for this page.
     * The page will be re-rendered on every request.
     */
    cache_disableAutomaticCache() {
        let routeInfos = this.webSite.getRouteInfos("GET", this.route);
        if (!routeInfos) return;

        routeInfos.mustEnableAutomaticCache = false;
    }

    /**
     * Define a function which is called to read the cache.
     * This allows replacing the default cache reading behavior.
     * @param handler
     */
    cache_readCacheEntry(handler: (req: JopiRequest) => Promise<Response | undefined>): void {
        let routeInfos = this.webSite.getRouteInfos("GET", this.route);
        if (!routeInfos) return;

        routeInfos.readCacheEntry = handler;
    }

    
    /**
     * Defines a hook called after a response is retrieved from the cache.
     * Allows modifying or replacing the cached response before it is sent to the client.
     * @param handler An async function that can return a new Response.
     */
    cache_afterGetFromCache(handler: (req: JopiRequest, res: Response) => Promise<Response | undefined | void>) {
        let routeInfos = this.webSite.getRouteInfos("GET", this.route);
        if (!routeInfos) return;

        routeInfos.afterGetFromCache = handler;
    }

    /**
     * Defines a hook called before a response is added to the cache.
     * Allows altering the response or preventing it from being cached (by returning undefined).
     * @param handler An async function returning the modified Response or undefined.
     */
    cache_beforeAddToCache(handler: (req: JopiRequest, res: Response) => Promise<Response | undefined | void>) {
        let routeInfos = this.webSite.getRouteInfos("GET", this.route);
        if (!routeInfos) return;

        routeInfos.beforeAddToCache = handler;
    }

    /**
     * Defines a hook called before checking the cache.
     * Can be used for custom security checks or to return a specific response early, bypassing the cache.
     * @param handler An async function that can return a Response to bypass the cycle.
     */
    cache_beforeCheckingCache(handler: (req: JopiRequest) => Promise<Response | undefined | void>) {
        let routeInfos = this.webSite.getRouteInfos("GET", this.route);
        if (!routeInfos) return;

        routeInfos.beforeCheckingCache = handler;
    }

    /**
     * Defines a hook called when a request is made for a page that is not currently in the cache.
     * Useful for logging or pre-fetching related data.
     * @param handler Success callback.
     */
    cache_ifNotInCache(handler: (req: JopiRequest) => void): void {
        let routeInfos = this.webSite.getRouteInfos("GET", this.route);
        if (!routeInfos) return;

        routeInfos.ifNotInCache = handler;
    }
}

/**
 * Metadata for a menu item associated with a route.
 */
interface MenuItemForRouteConfig {
    /** The displayed text or translation key. */
    title?: string,
    /** Lucide icon name or image path. */
    icon?: string,
    /** Sorting order in the menu. */
    priority?: number,
    /** Translations for the menu title. Key is language code (e.g. 'en_us'). */
    translations?: Record<string, string>
}