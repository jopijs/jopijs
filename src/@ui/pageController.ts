// noinspection JSUnusedGlobalSymbols

import React, { useState, useEffect } from "react";
import { type ServerRequestInstance } from "./hooks/index.ts";
import { decodeUserInfosFromCookie, isUserInfoCookieUpdated, type UiUserInfos } from "./user.ts";
import { deleteCookie } from "./cookies/index.ts";
import * as jk_events from "jopi-toolkit/jk_events";
import type { JopiUiApplication_Host } from "./modules.ts";
import { isServerSide } from "jopi-toolkit/jk_what";
import { getDefaultValueStore, type IsValueStore, ValueStore } from "./valueStore.ts";
import type {HtmlNode} from "./htmlNode.ts";

export interface PageOptions {
    pageTitle?: string;
    head?: HtmlNode[];
    bodyBegin?: HtmlNode[];
    bodyEnd?: HtmlNode[];

    htmlProps?: Record<string, any>;
    bodyProps?: Record<string, any>;
    headProps?: Record<string, any>;
}

export class UsePageDataException extends Error {
    constructor(public readonly serverAction: (t: any) => Promise<any>, public readonly callParams: any) {
        super("UsePageDataException");
        this.name = "UsePageDataException";
    }
}

/**
 * Page controller is an object that can be accessed
 * from any React component from the `_usePage`hook.
 */
export class PageController<T = any> implements JopiUiApplication_Host {
    private readonly isServerSide: boolean = isServerSide;

    // @ts-ignore
    private readonly isReactHMR: boolean = "JOPI_BUNDLER_UI_MODE" === "ReactHMR";

    private readonly usedKeys = new Set<String>();

    protected readonly state: PageOptions;
    protected serverRequest?: ServerRequestInstance;
    protected userInfos?: UiUserInfos;

    public readonly events = isServerSide ? jk_events.newEventGroup() : jk_events.defaultEventGroup;
    public readonly valueStore: IsValueStore = isServerSide ? new ValueStore() : getDefaultValueStore();

    constructor(public readonly isDetached = false, public readonly mustRemoveTrailingSlashes: boolean = false, options?: PageOptions) {
        options = options || {};

        this.state = { ...options };
    }

    /**
     * Allow storing custom internal data inside the page context.
     */
    data: T = {} as unknown as T;

    //region JopiUiApplication_Host

    /**
     * Return the current page url.
     * For server-side: correspond to the url of the request.
     * For browser-side: is the navigateur url.
     */
    public getCurrentURL(): URL {
        if (this.serverRequest) {
            return this.serverRequest.req_urlInfos;
        }

        return new URL(window.location.href);
    }

    public getUserInfos(): UiUserInfos | undefined {
        if (isServerSide) {
            return this.userInfos;
        }

        if (!this.userInfos) {
            this.userInfos = decodeUserInfosFromCookie();
        }

        return this.userInfos;
    }

    //endregion

    //region Page options (header/props/...)

    public addToHeader(item: HtmlNode, force: boolean = false) {
        if (this.isServerSide) {
            if (!this.checkKey("h" + item.key)) return this;
            if (!this.state.head) this.state.head = [item];
            else this.state.head.push(item);
        } else {
            if (this.isReactHMR) force = true;
 
            if (force) {
                // >>> With React HMR there is not server pre-rendering.
                //     It's why here we allow injecting items into the header.

                let domNode = document.createElement(item.tag);
                domNode.setAttribute('key', item.key);
                
                let copy: any = { ...item };
                delete copy.tag;
                delete copy.key;

                for (let k in copy) {
                    if (k === "content") {
                        domNode.innerHTML = copy[k];
                    } else {
                        domNode.setAttribute(k, copy[k]);
                    }
                }

                const existingElement = document.querySelector(`[key="${item.key}"]`);
                if (existingElement) existingElement.remove();

                document.head.appendChild(domNode);
            }
        }

        return this;
    }

    public addToBodyBegin(node: HtmlNode) {
        if (this.isServerSide) {
            if (!this.checkKey("bb" + node.key)) return this;

            if (!this.state.bodyBegin) this.state.bodyBegin = [node];
            else this.state.bodyBegin.push(node);

            // Required to trigger a browser-side refresh of the body.
            this.onStateUpdated(this.state);
        }

        return this;
    }

    public addToBodyEnd(node: HtmlNode) {
        if (this.isServerSide) {
            if (!this.checkKey("be" + node.key)) return this;

            if (!this.state.bodyEnd) this.state.bodyEnd = [node];
            else this.state.bodyEnd.push(node);

            // Required to trigger a browser-side refresh of the body.
            this.onStateUpdated(this.state);
        }

        return this;
    }

    public setHeadTagProps(key: string, value: any) {
        if (this.isServerSide) {
            if (!this.state.headProps) this.state.headProps = {};
            this.state.headProps[key] = value;
        }

        return this;
    }

    public setHtmlTagProps(key: string, value: any) {
        if (this.isServerSide) {
            if (!this.state.htmlProps) this.state.htmlProps = {};
            this.state.htmlProps[key] = value;
        }

        return this;
    }

    public setBodyTagProps(key: string, value: any) {
        if (this.isServerSide) {
            if (!this.state.bodyProps) this.state.bodyProps = {};
            this.state.bodyProps[key] = value;
        }

        return this;
    }

    public setPageTitle(title: string) {
        if (this.isServerSide) {
            this.state.pageTitle = title;
        } else {
            document.title = title;
        }

        return this;
    }

    private checkKey(key: string) {
        if (this.usedKeys.has(key)) {
            return false;
        }

        this.usedKeys.add(key);
        return true;
    }

    //endregion

    public refreshUserInfos() {
        if (!isServerSide && isUserInfoCookieUpdated()) {
            this.userInfos = decodeUserInfosFromCookie();
            jk_events.sendEvent("app.user.infosUpdated");
        }
    }

    public logOutUser() {
        if (!isServerSide) {
            deleteCookie("authorization");
        }

        this.refreshUserInfos();
    }

    onStateUpdated(_state: PageOptions) {
        // Will be dynamically replaced.
    }

    onRequireRefresh() {
        // Will be dynamically replaced.
    }

    pageDataResult: any;
    isPageDataResultSet: boolean = false;
    hasPageDataError: boolean = false;

    usePageData<T, V>(serverAction: (t: T) => Promise<V>, t: T): {
        data: V|undefined,
        isLoading: boolean,
        isError: boolean,
    } {
        if (isServerSide) {
            // Already computed? Return the result.
            if (this.isPageDataResultSet) {
                return {
                    data: this.pageDataResult,
                    isLoading: false,
                    isError: this.hasPageDataError,
                };
            }

            // Will be caught by the page renderer
            // in order to execute the server action and re-render.
            //
            throw new UsePageDataException(serverAction, t);
        } else {
            const [isLoading, setIsLoading] = useState(true);
            const [isError, setIsError] = useState(false);
            const [value, setValue] = useState<V | undefined>(undefined);
        
            useEffect(() => {
                 serverAction(t).then((v) => {
                    setValue(v);
                    setIsLoading(false);
                 }).catch((e) => {
                    setIsError(true);
                    setIsLoading(false);
                 });
            }, []);

            return {
                data: value,
                isLoading,
                isError,
            }
        }
    }
}

export class PageController_ExposePrivate<T = any> extends PageController<T> {
    getOptions(): PageOptions {
        return this.state;
    }

    setServerRequest(serverRequest: ServerRequestInstance) {
        this.valueStore.setValue("jopi.serverRequest", serverRequest);

        this.serverRequest = serverRequest;
        this.userInfos = serverRequest.user_getUserInfos();
    }

    getServerRequest(): ServerRequestInstance {
        return this.serverRequest!;
    }
}

export type PageHook = (controller: PageController_ExposePrivate<unknown>) => void;

// On server-side: the instance is created when rendering the page.
// On browser-side: the instance is through generated code (see .jopijs/site/page_???.jsx)
//
export const PageContext = React.createContext<PageController<unknown> | undefined>(undefined);

