import React, { useEffect } from "react";
import { PageContext, PageController_ExposePrivate } from "./pageController.ts";
import { useParams } from "./hooks/index.ts";
import * as jk_events from "jopi-toolkit/jk_events";

export type JRouterComponent = React.ComponentType<{ children?: React.ReactNode }>;

/**
 * The default router implementation.
 * It simply returns the children as-is.
 */
export function DefaultRouter({children}: {children?: React.ReactNode}) {
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
 * Render the component C (corresponding to the `page.tsx` file).
 */
function Render({C, controller, params, searchParams}: { 
    C: React.ComponentType<any>, 
    controller: PageController_ExposePrivate, 
    params: Record<string, string>, 
    searchParams: Record<string, string>
}) {
    const [_, setCount] = React.useState(0);
    controller.onRequireRefresh = () => setCount(old => old + 1);
    const [Component, setComponent] = React.useState<React.ComponentType<any>>(() => C);

    useEffect(() => {
        const listener = (data?: { Component: React.ComponentType<any> | null }) => {
            alert("update content")
            if (!data || !data.Component) return;
            //setComponent(data.Component);
            setComponent(() =><div>Replaced</div>);
        };

        jk_events.addListener("jopi.router.update-content", listener);
        return () => { jk_events.removeListener("jopi.router.update-content", listener) };
    }, []);

    return <Component params={params} searchParams={searchParams} />;
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
                <RouterImpl>
                    <Render 
                        C={C} 
                        controller={controller} 
                        params={params} 
                        searchParams={searchParams}
                    />
                </RouterImpl>
            </PageContext.Provider>
        </React.StrictMode>
    );
}