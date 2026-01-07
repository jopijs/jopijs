import type {CookieOptions} from "./interfaces.ts";

export function setCookie(name: string, value: string, options?: CookieOptions) {
    let cookieStr = `${name}=${value}`;

    options = {
        path: "/",
        maxAge: 315360000, // 10 years
        ...options
    };

    if (options.maxAge !== undefined) cookieStr += `; max-age=${options.maxAge}`;
    if (options.expires) cookieStr += `; expires=${options.expires.toUTCString()}`;
    if (options.path) cookieStr += `; path=${options.path}`;
    if (options.domain) cookieStr += `; domain=${options.domain}`;
    if (options.secure) cookieStr += `; secure`;
    if (options.sameSite) cookieStr += `; samesite=${options.sameSite}`;
    if (options.priority) cookieStr += `; priority=${options.priority}`;

    document.cookie = cookieStr;
}

export function deleteCookie(name: string) {
    let current = getCookieValue(name);
    if (current === undefined) return;

    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;

    // Allow to be ok until document.cookie is refreshed.
    delete gCookies![name];
}

export function getCookieValue(name: string): string|undefined {
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