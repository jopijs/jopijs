// noinspection JSUnusedGlobalSymbols

import React from "react";
import {PageContext, PageController} from "../pageController.ts";
import {CssModule, type UseCssModuleContextProps} from "../cssModules.tsx";
import {PageModifier} from "../pageModifier.tsx";
import type {CookieOptions} from "../cookies/index.ts";
import type {UiUserInfos} from "../user.ts";


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

    // Will allow knowing if the module is already inserted for this page.
    if (!ctx.data.jopiUseCssModule) ctx.data.jopiUseCssModule = {};

    // Not already added? Then add it.
    if (fileHash && !ctx.data.jopiUseCssModule[fileHash]) {
        ctx.data.jopiUseCssModule![fileHash] = true;

        // Will allow inlining the style inside the page.
        //ctx.addToBodyBegin(fileHash, <CssModule key={fileHash} module={cssModule}/>);
        ctx.addToHeader(fileHash, <CssModule key={fileHash} module={cssModule}/>);
    }
}

export interface ReactStaticEvent {
    send<T>(data: T): T;
    reactListener<T>(listener: (data: T) => void): void;
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
    req_urlParts?: Record<string, any>;
    req_urlInfos: URL;
    req_headers: Headers;

    user_getUserInfos(): UiUserInfos | undefined;
    role_getUserRoles(): string[];
    role_userHasOneOfThisRoles(requiredRoles: string[]): boolean;
    role_userHasRole(requiredRole: string): boolean;

    react_getPageData(): PageDataProviderData|undefined;

    cache_ignoreCacheWrite(): void;
    get customData(): any;

    cookie_reqHasCookie(name: string, value?: string): boolean;
    cookie_getReqCookie(name: string): string | undefined;
    cookie_addCookieToRes(cookieName: string, cookieValue: string, options?: CookieOptions): void;
    cookie_deleteResCookie(name: string): void;
}
