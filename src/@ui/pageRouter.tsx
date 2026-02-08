import React from "react";
import { PageContext, PageController_ExposePrivate } from "./pageController.ts";

export type JRouterComponent = React.ComponentType<{ children?: React.ReactNode, controller: PageController_ExposePrivate }>;

/**
 * The default router implementation.
 * It simply returns the children as-is.
 */
const DefaultRouter: JRouterComponent = ({children}) => {
    return children;
}

/**
 * Allows setting the router implementation.
 */
export function setRouterImplementation(impl: JRouterComponent) {
    RouterImpl = impl;
}

export function calcPageParams(routeInfos: { route: string, catchAll?: string }): Record<string, string> {
    const pathname = new URL(window.location.href).pathname;
        
    // If no route infos are present (e.g. error page or static page without hydration),
    // we return an empty object.
    //
    if (!routeInfos) return {};

    const route = routeInfos.route;
    const pRoute = route.split("/");
    const pPathname = pathname.split("/");
    
    const pageParams: Record<string, string> = {};

    // Extract parameters from the URL based on the route definition.
    //
    for (let i = 0; i < pRoute.length; i++) {
        let p = pRoute[i];
        if (p[0] === ":") pageParams[p.substring(1)] = pPathname[i];
        else if (p[0] === "*") pageParams[routeInfos.catchAll!] = pPathname.slice(i).join("/");
    }

    console.log("calcPageParams", pageParams);
    return pageParams;
}

/**
 * The router implementation to use.
 * Use updated through a call to `setRouterImplementation` by the real router.
 */
let RouterImpl: JRouterComponent = DefaultRouter;

interface RouteInfos {
    route: string;
    catchAll?: string;
}

export function calcParams(routeInfos: RouteInfos): any {
    const pathname = new URL(window.location.href).pathname;
        
    // If no route infos are present (e.g. error page or static page without hydration),
    // we return an empty object.
    //
    if (!routeInfos) return {};

    const route = routeInfos.route;
    const pRoute = route.split("/");
    const pPathname = pathname.split("/");
    let pageParams: any = {};

    // Extract parameters from the URL based on the route definition.
    //
    for (let i = 0; i < pRoute.length; i++) {
        let p = pRoute[i];
        if (p[0] === ":") pageParams[p.substring(1)] = pPathname[i];
        else if (p[0] === "*") pageParams[routeInfos.catchAll!] = pPathname.slice(i).join("/");
    }

    return pageParams;
}

/**
 * Set the controller's onRequireRefresh callback.
 * This allows forcing a re-render of the current page.
 * This feature is mainly used by the login/logout hooks.
 */
function AllowPageRefresh({controller, children}: { 
    controller: PageController_ExposePrivate, 
    children: React.ReactNode
}) {
    const [_, setCount] = React.useState(0);
    controller.onRequireRefresh = () => setCount(old => old + 1);
    return children;
}

/**
 * Is called by the generated page entry point (see pageGenerator.ts).
 * It creates the root of the application.
 * 
 * BROWSER SIDE ONLY
 * 
 * We have something like:
 * const app = createAppRoot(C);
 * const container = document.body;
 * ReactDOM.createRoot(container).render(app);
 * 
 * @param C The component to render.
 *        Correspond to the `page.tsx` file.
 * @returns The final React component to render.
 */
export function createAppRoot(C: React.ComponentType<any>) {
    // Information on the current page are stored into the HTML himself (__JOPI_ROUTE__).
    // Here we are in the case of the page directly loaded by the browser.
    // So we can use this static information to calculate the page parameters.
    //
    const staticRouteInfos = (window as any)["__JOPI_ROUTE__"] as RouteInfos;
    
    let searchParams: Record<string, string>;
    const urlObject = new URL(window.location.href).searchParams;
    
    if ((urlObject as any).toJSON) {
        searchParams = (urlObject as any).toJSON();
    }
    else {
        searchParams = {};
        urlObject.forEach((v,k) => (searchParams as any)[k] = v);
    }
    
    const pageParams = calcParams(staticRouteInfos);
    const controller = new PageController_ExposePrivate();

    const initialRouteInfos = {
        Component: null,
        path: staticRouteInfos.route,
        pageProps: { params: pageParams, searchParams: searchParams }
    };
    
    console.log("initialRouteInfos", initialRouteInfos);
    
    // Will be used by the fake router functions.
    (window as any)["__JOPI_ROUTER_CONTEXT__"] = {
        ...initialRouteInfos,
        
        navigate: (to: string, options?: { replace?: boolean }) => {
            if (options?.replace) {
                window.location.replace(to);
            } else {
                window.location.href = to;
            }
        }
    };
    
    return (
        <React.StrictMode>
            <PageContext.Provider value={controller}>
                <RouterImpl controller={controller}>
                    <AllowPageRefresh controller={controller}>
                        <C params={initialRouteInfos.pageProps.params} searchParams={initialRouteInfos.pageProps.searchParams} />
                    </AllowPageRefresh>
                </RouterImpl>
            </PageContext.Provider>
        </React.StrictMode>
    );
}