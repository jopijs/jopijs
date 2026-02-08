import React from "react";
import { PageContext, PageController_ExposePrivate } from "./pageController.ts";
import { useParams } from "./hooks/index.ts";

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

/**
 * The router implementation to use.
 * Use updated through a call to `setRouterImplementation` by the real router.
 */
let RouterImpl: JRouterComponent = DefaultRouter;

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
    const params = useParams();
    
    let searchParams: Record<string, string>;
    const coreSearchParams = new URL(window.location.href).searchParams;
    
    if ((coreSearchParams as any).toJSON) {
        searchParams = (coreSearchParams as any).toJSON();
    }
    else {
        searchParams = {};
        coreSearchParams.forEach((v,k) => (searchParams as any)[k] = v);
    }
    
    const controller = new PageController_ExposePrivate();
    
    return (
        <React.StrictMode>
            <PageContext.Provider value={controller}>
                <RouterImpl controller={controller}>
                    <AllowPageRefresh controller={controller}>
                        <C params={params} searchParams={searchParams} />
                    </AllowPageRefresh>
                </RouterImpl>
            </PageContext.Provider>
        </React.StrictMode>
    );
}