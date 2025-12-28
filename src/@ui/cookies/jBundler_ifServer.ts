import {PageContext, PageController_ExposePrivate} from "../pageController.ts";
import React from "react";
import type {CookieOptions} from "./interfaces.ts";

function getContext(): PageController_ExposePrivate {
    return React.useContext(PageContext) as PageController_ExposePrivate
}

/**
 * Returns the value of the cookie.
 * Works browser side and server side.
 *
 * @param name
 *      The name of the cookie we want.
 */
export function getCookieValue(name: string): string|undefined {
    return getContext().getServerRequest().cookie_getReqCookie(name);
}

export function setCookie(name: string, value: string, options?: CookieOptions) {
    getContext().getServerRequest().cookie_addCookieToRes(name, value, options);
}

export function deleteCookie(name: string) {
    getContext().getServerRequest().cookie_deleteResCookie(name);
}