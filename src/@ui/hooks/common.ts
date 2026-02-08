// noinspection JSUnusedGlobalSymbols

import React, {useEffect, useState} from "react";
import {PageContext, PageController} from "../pageController.ts";
import {type UseCssModuleContextProps} from "../cssModules.ts";
import {PageModifier} from "../pageModifier.ts";
import type {CookieOptions} from "../cookies/index.ts";
import type {UiUserInfos} from "../user.ts";
import type {IsValueStore} from "../valueStore.ts";

/**
 * Allow getting a reference to the PageController.
 * **USING IT MUST BE AVOIDED** since it's a technical item.
 * It's the reason of the underscore.
 */
export function _usePage<T = any>(): PageController<T> {
    let res = React.useContext(PageContext) as PageController<T>;

    // Not wrapped inside a PageContext?
    if (!res) {
        res = new PageController<T>(true);
    }

    return res;
}

/**
 * Returns the value store which role is to save value accross the whole application.
 */
export function useValueStore(): IsValueStore {
    const ctx = React.useContext(PageContext) as PageController;
    return ctx.valueStore;
}

/**
 * Get a value from the value store.
 */
export function useStoreValue<T>(key: string): [T, (v: T) => void] {
    const store = useValueStore();
    const [_, setCount] = useState(0);

    useEffect(() => {
        const listener = () => { setCount(c => c+ 1) };
        return store.onValueChange(key, listener);
    }, []);

    return [store.getValue(key)!, (v: T) => store.setValue(key, v)];
}

/**
 * Allows setting the page title.
 * @param title
 */
export function usePageTitle(title: string) {
    const page = React.useContext(PageContext) as PageController;
    if (page) page.setPageTitle(title);
}

/**
 * Returns an object allowing to modify the page content.
 */
export function usePageModifier(): PageModifier {
    const page = React.useContext(PageContext) as PageController;
    return new PageModifier(page);
}

// @ts-ignore
const _isReactHMR = "JOPI_BUNDLER_UI_MODE" === "ReactHMR";

export function isReactHMR() {
    return _isReactHMR;
}

export function useCssModule(cssModule: undefined | Record<string, string>) {
    if (!cssModule) return;

    // Not a real CSS Module?
    const fileHash = cssModule.__FILE_HASH__;
    if (!fileHash) return;

    const ctx = _usePage<UseCssModuleContextProps>();
   
    // Will allow inlining the style inside the page.
    //
    // Here we force adding it, since it must be added form browser-side
    // when a component is mounted for the first time/
    //
    const values: any = { tag: "style", key: fileHash, content: cssModule.__CSS__ };

    if (cssModule.__FILE_PATH__) {
        values.file = cssModule.__FILE_PATH__;
    }

    ctx.addToHeader(values, true);
}

export interface ReactStaticEvent {
    send<T>(data?: T): T | undefined;
    reactListener<T>(listener: (data?: T) => void): void;
}

export interface PageDataProviderData {
    seed?: any;
    global?: any;
    items?: any[];

    // Allows knowing which property must be used as id
    // to merge old / new items.
    //
    itemKey?: string;
}

export interface UsePageDataResponse extends PageDataProviderData {
    isLoading: boolean;
    isStaled: boolean;
    isError: boolean;
}

/**
 * Is a subset of JopiRequest, with only browser-side compatible items.
 */
export interface ServerRequestInstance {
    /**
     * The dynamic parts of the URL path derived from the route definition.
     * Example:
     * - Route: `/products/[category]/[id]`
     * - URL: `/products/electronics/123`
     * - Result: `{ category: "electronics", id: "123" }`
     */
    req_urlParts?: Record<string, any>;
    
    req_urlInfos: URL;
    req_headers: Headers;

    user_getUserInfos(): UiUserInfos | undefined;
    role_getUserRoles(): string[];
    role_userHasOneOfThisRoles(requiredRoles: string[]): boolean;
    role_userHasRole(requiredRole: string): boolean;

    react_getPageData(): PageDataProviderData | undefined;

    htmlCache_ignoreCacheWrite(): void;
    htmlCache_ignoreDefaultBehaviors(): void;
    get customData(): any;

    cookie_reqHasCookie(name: string, value?: string): boolean;
    cookie_getReqCookie(name: string): string | undefined;
    cookie_addCookieToRes(cookieName: string, cookieValue: string, options?: CookieOptions): void;
    cookie_deleteResCookie(name: string): void;
}
