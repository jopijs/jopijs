// noinspection JSUnusedGlobalSymbols

import React from "react";
import {PageController_ExposePrivate} from "../pageController.ts";
import * as jk_events from "jopi-toolkit/jk_events";
import {_usePage, type ReactStaticEvent, type ServerRequestInstance} from "./common.tsx";

export function useParams(): any {
    return useServerRequest().urlParts;
}

/**
 * Is the same as React.useEffect, but is executed even on the server side.
 *
 * !! Using it is not recommended since most of the pages are put in cache.
 */
export function useStaticEffect(effect: React.EffectCallback,
                                deps?: React.DependencyList) {
    effect();
}

/**
 * Is the same as React.useEffect, but is executed on the server side (only).
 */
export function useServerEffect(effect: React.EffectCallback,
                                deps?: React.DependencyList) {
    effect();
}

/**
 * Is the same as React.useEffect, but is executed on the browser side (only).
 */
export function useBrowserEffect(effect: React.EffectCallback,
                                  deps?: React.DependencyList) {
}

export function useServerRequest(): ServerRequestInstance {
    let page = _usePage();
    return (page as PageController_ExposePrivate).getServerRequest();
}

/**
 * Allows listening to an event, and automatically
 * unregister when the component unmount.
 */
export function useEvent(evenName: string|string[], listener: (data: any) => void) {
    // Nothing on server side.
}

export function useStaticEvent(event: jk_events.StaticEvent): ReactStaticEvent {
    return gFakeEvent;
}

const gFakeEvent: ReactStaticEvent = {
    send(data) { return data; },
    reactListener(){}
}
