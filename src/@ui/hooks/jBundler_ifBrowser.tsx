// noinspection JSUnusedGlobalSymbols

import React, {useEffect} from "react";
import * as jk_events from "jopi-toolkit/jk_events";
import {type ReactStaticEvent, type ServerRequestInstance} from "./common.tsx";

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