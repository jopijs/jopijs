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

export function usePageData(): UsePageDataResponse {
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
                // Note: Using ".then(...)" allow avoiding blocking the current call.
                //
                refreshPageData(rawPageData.u).then(() => {
                    gPageDataState!.isStaled = false;
                    jk_events.sendEvent("jopi.page.dataRefreshed", gPageDataState);
                });
            }
        }
    }

    const [pageData, setPageData] = React.useState<UsePageDataResponse>({
        ...gPageDataState.data,

        isLoading: gPageDataState.isLoading,
        isStaled: gPageDataState.isStaled,
        isError: gPageDataState.isError
    });

    useEvent("jopi.page.dataRefreshed", (data: PageDataState) => {
        console.log("Page data refreshed:", data);
        setPageData(data);
    });

    return pageData;
}

async function refreshPageData(url: string): Promise<void> {
    function mergeItems(itemKey: string, newItems: any[], oldItems: any[]): any[] {
        let res: any[] = [];

        for (let item of newItems) {
            let id = item[itemKey];

            for (let old of oldItems) {
                let oldId = old[itemKey];

                if (id === oldId) {
                    item = {...old, ...item};
                    break;
                }
            }

            res.push(item);
        }

        return res;
    }

    function mergeResponse(newData: PageDataProviderData, oldData?: PageDataProviderData): PageDataProviderData {
        if (!newData) return oldData!;

        if (!newData.seed) {
            newData.seed = oldData!.seed;
        }

        if (!newData.global) {
            newData.global = oldData!.global;
        }

        if (!newData.itemKey) {
            newData.itemKey = oldData!.itemKey;
        }

        if (!newData.items) {
            newData.items = oldData!.items;
        } else {
            if (oldData!.items) {
                if (!newData.itemKey) {
                    console.log("Page data: no itemKey defined. Cannot merge items.")
                } else {
                    newData.items = mergeItems(newData.itemKey, newData.items, oldData!.items)
                }
            }
        }

        return newData;
    }

    gPageDataState!.isLoading = true;
    gPageDataState!.isError = false;

    let res = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(gPageDataState!.data!.seed)
    });

    gPageDataState!.isLoading = false;

    if (res.ok) {
        let data = (await res.json()) as PageDataProviderData;
        data = mergeResponse(data, gPageDataState!.data);

        gPageDataState!.data = data;
        gPageDataState!.isError = false;
        gPageDataState!.isStaled = false;

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