import type {CookieOptions} from "./interfaces.ts";

export function setCookie(name: string, value: string, options?: CookieOptions) {
    let cookieStr = `${name}=${value}; path=/`;

    if (options?.maxAge !== undefined) {
        cookieStr += `; max-age=${options.maxAge}`;
    }

    document.cookie = cookieStr;
}

export function deleteCookie(name: string) {
    let current = getCookieValue(name);
    if (current === undefined) return;

    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;

    // Allow to be ok until document.cookie is refreshed.
    delete gCookies![name];
}

/**
 * Returns the value of the cookie.
 * Works browser side and server side.
 *
 * @param name
 *      The name of the cookie we want.
 */
export function getCookieValue(name: string) {
    let currentCookies = document.cookie;

    if (gCookies) {
        if (gCookieString !== currentCookies) {
            gCookieString = currentCookies;
            gCookies = undefined;
        }
    }

    if (!gCookies) {
        gCookies = {};

        currentCookies.split(';').forEach(c => {
            c = c.trim();
            let idx = c.indexOf("=");
            gCookies![c.substring(0, idx)] = c.substring(idx + 1);
        });
    }

    return gCookies![name];
}

let gCookies: undefined|Record<string, string>;
let gCookieString = "";