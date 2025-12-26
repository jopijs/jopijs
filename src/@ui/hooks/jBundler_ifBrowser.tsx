// noinspection JSUnusedGlobalSymbols

import React, {useEffect} from "react";
import * as jk_events from "jopi-toolkit/jk_events";
import {
    type PageDataProviderData,
    type ReactStaticEvent,
    type ServerRequestInstance,
    type UsePageDataResponse
} from "./common.tsx";

export function useParams(): any {
    if (gPageParams===undefined) {
        let pathname = new URL(window.location.href).pathname;
        let route = ((window as any)["__JOPI_ROUTE__"]) as string;
        if (!route) return gPageParams = {};

        let pRoute = route.split("/");
        let pPathname = pathname.split("/");
        gPageParams = {};

        for (let i = 0; i < pRoute.length; i++) {
            let p = pRoute[i];
            if (p[0]===":") gPageParams[p.substring(1)] = pPathname[i];
        }
    }

    return gPageParams;
}

let gPageParams: any|undefined;

/**
 * useStaticEffect is the same as React.useEffect, but is executed even on the server side.
 *
 * !! Using it is not recommended since most of the pages are put in cache.
 */
export function useStaticEffect(effect: React.EffectCallback,
                                deps?: React.DependencyList) {
    useEffect(effect, deps);
}

export function useServerEffect(effect: React.EffectCallback,
                                deps?: React.DependencyList) {
}

export function useBrowserEffect(effect: React.EffectCallback,
                                 deps?: React.DependencyList) {
    useEffect(effect, deps);
}

/**
 * Allows listening to an event, and automatically
 * unregister when the component unmount.
 */
export function useEvent(evenName: string|string[], listener: (data: any) => void) {
    useEffect(() => {
        if (evenName instanceof Array) {
            evenName.forEach(e => {
                jk_events.addListener(e, listener);
            });

            return () => {
                evenName.forEach(e => {
                    jk_events.removeListener(e, listener);
                });
            }
        }

        jk_events.addListener(evenName, listener);
        return () => { jk_events.removeListener(evenName, listener) };
    }, [evenName, listener]);
}

export function useStaticEvent(event: jk_events.StaticEvent): ReactStaticEvent {
    const canAddListener = (event as any).addListener !== undefined;

    return {
        send<T>(data: T): T {
            return event.send(data);
        },

        reactListener<T>(listener: (data: T) => void) {
            if (!canAddListener) return;

            useEffect(() => {
                return (event as unknown as jk_events.SEventController).addListener(listener);
            }, [listener]);
        }
    }
}

export function useServerRequest(): ServerRequestInstance {
    throw new Error("useServerRequest is not available on the browser side.");
}

//region Page Data

export function usePageData(): UsePageDataResponse|undefined {
    const [_, setCount] = React.useState(0);

    if (!gPageDataState) {
        const rawPageData = (window as any)["JOPI_PAGE_DATA"];

        if (!rawPageData) {
            gPageDataState = {
                isLoading: false,
                isStaled: false,
                isError: false,
                hasData: false
            };
        } else {
            const pageData = rawPageData.d as PageDataProviderData;

            gPageDataState = {
                data: pageData,
                hasData: pageData !== undefined,
                isLoading: false,
                isStaled: true,
                isError: false
            };

            // If not url (rawPageData.u) it means there is no getRefreshedData function defined.
            //
            if (pageData && rawPageData.u) {
                // Using then allow avoiding blocking the current call.
                //
                // TODO: je ne peux pas refresh comme ça car je peux avoir plusieurs écouteurs.
                //       Il me faut donc utiliser un event.
                //
                refreshPageData(rawPageData.u).then(() => {
                    gPageDataState!.isStaled = false;
                    setCount(c => c + 1)
                });
            }
        }
    }
    
    return {
        ...gPageDataState.data,

        isLoading: gPageDataState.isLoading,
        isStaled: gPageDataState.isStaled,
        isError: gPageDataState.isError
    };
}

async function refreshPageData(url: string): Promise<void> {
    gPageDataState!.isLoading = true;
    gPageDataState!.isError = false;

    console.log("sending seed:", gPageDataState!.data!.seed);

    let res = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(gPageDataState!.data!.seed)
    });

    gPageDataState!.isLoading = false;

    if (res.ok) {
        gPageDataState!.data = (await res.json()) as PageDataProviderData;
        gPageDataState!.isError = false;
        gPageDataState!.isStaled = false;

        console.log("received seed:", gPageDataState!.data!.seed);

    } else {
        gPageDataState!.isError = true;
    }
}

interface PageDataState {
    data?: PageDataProviderData,
    hasData?: boolean,
    canRefresh?: true,
    isLoading: boolean,
    isStaled: boolean
    isError: boolean
}


let gPageDataState: PageDataState|undefined;

//endregion