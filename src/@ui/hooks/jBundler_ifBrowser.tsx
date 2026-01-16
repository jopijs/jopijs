// noinspection JSUnusedGlobalSymbols

import React, { useEffect } from "react";
import * as jk_events from "jopi-toolkit/jk_events";
import {
    type PageDataProviderData,
    type ReactStaticEvent,
    type ServerRequestInstance,
    type UsePageDataResponse
} from "./common.tsx";

export function useParams(): any {
    if (gPageParams === undefined) {
        const pathname = new URL(window.location.href).pathname;
        const routeInfos = ((window as any)["__JOPI_ROUTE__"]) as { route: string, catchAll?: string };
        
        // If no route infos are present (e.g. error page or static page without hydration),
        // we return an empty object.
        //
        if (!routeInfos) return gPageParams = {};

        const route = routeInfos.route;
        const pRoute = route.split("/");
        const pPathname = pathname.split("/");
        gPageParams = {};

        // Extract parameters from the URL based on the route definition.
        //
        for (let i = 0; i < pRoute.length; i++) {
            let p = pRoute[i];
            if (p[0] === ":") gPageParams[p.substring(1)] = pPathname[i];
            else if (p[0] === "*") gPageParams[routeInfos.catchAll!] = pPathname.slice(i);
        }
    }

    return gPageParams;
}

let gPageParams: any | undefined;

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
export function useEvent(evenName: string | string[], listener: (data: any) => void) {
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

/**
 * This hook allows accessing page data and optionally refreshing it with a new seed.
 *
 * @param useThisSeed If defined, it forces a refresh of the page data using this seed.
 *                    This is useful for implementing filters or pagination where the client
 *                    needs to request data different from the initial page load.
 */
export function usePageData(useThisSeed?: any): UsePageDataResponse {
    //region Static checking.

    // Data cache stored into the HTML himself.
    const rawPageData = (window as any)["JOPI_PAGE_DATA"];

    if (!rawPageData) {
        if (!gPageDataState) {
            gPageDataState = {
                hasData: false,
                isLoading: false,
                isStaled: true,
                isError: false
            };
        }

        return gPageDataState;
    }

    // The data part.
    const pageData = rawPageData.d as PageDataProviderData;

    // Create the initial data object, with which we will merge the new data.
    //
    if (!gPageDataState) {
        gPageDataState = {
            data: pageData,
            hasData: pageData !== undefined,
            isLoading: false,
            isStaled: true,
            isError: false
        };
    }

    //endregion

    useEffect(() => {
        const performRefresh = () => {
            if (rawPageData && rawPageData.u) {
                // Prevent duplicate requests if we are already loading processing the same intention.
                if (gPageDataState!.isLoading) return;

                // The "then" avoid blocking the current call.
                //
                refreshPageData(rawPageData.u, useThisSeed).then(() => {
                    gPageDataState!.isStaled = false;

                    jk_events.sendEvent("jopi.page.dataRefreshed", {
                        ...gPageDataState!.data,

                        isLoading: false,
                        isStaled: false,
                        isError: gPageDataState!.isError
                    });
                });
            }
        };

        if (useThisSeed) {
            // If the seed changed, we must update the page data.
            // Compare the object instance himself to detect changes.
            //
            if (useThisSeed !== gPageDataState!.data?.seed) {
                if (!gPageDataState!.data) gPageDataState!.data = {};
                gPageDataState!.data.seed = useThisSeed;

                performRefresh();
            }
        } else {
            // If no seed provided, we just refresh if an endpoint exists,
            // effectively acting as a stale-while-revalidate / initial fetch.
            //
            if (rawPageData?.u) {
                performRefresh();
            }
        }
    }, [useThisSeed]);

    // Create the final response, with state informations.
    //
    const [newPageData, setPageData] = React.useState<UsePageDataResponse>({
        ...gPageDataState.data,

        isLoading: gPageDataState.isLoading,
        isStaled: gPageDataState.isStaled,
        isError: gPageDataState.isError
    });

    useEvent("jopi.page.dataRefreshed", (data: PageDataState) => {
        setPageData(data);
    });

    return newPageData;
}

/**
 * Refreshes the page data by sending a request to the server.
 *
 * @param url The URL endpoint to fetch data from (typically provided in initial page data).
 * @param useThisSeed Optional seed to use for the request. If provided, it overrides the current seed.
 */
async function refreshPageData(url: string, useThisSeed: any): Promise<void> {
    // We defined mergeItems helper directly here to avoid polluting the module scope.
    //
    function mergeItems(itemKey: string, newItems: any[], oldItems: any[]): any[] {
        let res: any[] = [];

        for (let item of newItems) {
            let id = item[itemKey];

            for (let old of oldItems) {
                let oldId = old[itemKey];

                if (id === oldId) {
                    item = { ...old, ...item };
                    break;
                }
            }

            res.push(item);
        }

        return res;
    }

    // This function will merge the new data with the old one.
    // Please note that it mutates neither newData nor oldData.
    //
    function mergeResponse(newData: PageDataProviderData, oldData?: PageDataProviderData): PageDataProviderData {
        if (!newData) return oldData!;

        // Preserve existing values if they are missing in the new response.
        // This allows the server to send partial updates (e.g. just the list of items).
        //

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
                // If we have new items and old items, we try to merge them smartly by ID
                // to preserve object references where possible or just update fields.
                //
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

    // Fetching the new data.
    //
    let res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gPageDataState!.data!.seed)
    });

    gPageDataState!.isLoading = false;

    if (res.ok) {
        let data = (await res.json()) as PageDataProviderData;
        
        // We merge the response with the previous data to keep the properties that were not present in the response.
        //
        data = mergeResponse(data, useThisSeed!==undefined ? useThisSeed : gPageDataState!.data);


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

let gPageDataState: PageDataState | undefined;

//endregion