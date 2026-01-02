// noinspection JSUnusedGlobalSymbols

import React from "react";
import ReactDOM from "react-dom/client";
import { type ServerRequestInstance } from "./hooks/index.ts";
import { decodeUserInfosFromCookie, isUserInfoCookieUpdated, type UiUserInfos } from "./user.ts";
import { deleteCookie } from "./cookies/index.ts";
import * as jk_events from "jopi-toolkit/jk_events";
import type { JopiUiApplication_Host } from "./modules.ts";
import { isServerSide } from "jopi-toolkit/jk_what";
import { getDefaultObjectRegistry, type IsObjectRegistry, ObjectRegistry } from "./objectRegistry.ts";

export interface PageOptions {
    pageTitle?: string;
    head?: React.ReactNode[];
    bodyBegin?: React.ReactNode[];
    bodyEnd?: React.ReactNode[];

    htmlProps?: Record<string, any>;
    bodyProps?: Record<string, any>;
    headProps?: Record<string, any>;
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
    public readonly objectRegistry: IsObjectRegistry = isServerSide ? new ObjectRegistry() : getDefaultObjectRegistry();

    constructor(public readonly isDetached = false, public readonly mustRemoveTrailingSlashes: boolean = false, options?: PageOptions) {
        options = options || {};

        this.state = { ...options };
    }

    /**
     * Allow storing custom data inside the page context.
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

    public addToHeader(key: string, entry: React.ReactNode) {
        if (this.isServerSide) {
            if (!this.checkKey("h" + key)) return this;
            if (!this.state.head) this.state.head = [entry];
            else this.state.head.push(entry);
        } else if (this.isReactHMR) {
            // >>> With React HMR there is not server pre-rendering.
            //     It's why here we allow injecting items into the header.

            const element = React.isValidElement(entry) ? entry : React.createElement(React.Fragment, null, entry);
            const container = document.createElement('div');
            container.setAttribute('data-jopi-key', key);

            const existingElement = document.querySelector(`[data-jopi-key="${key}"]`);
            if (existingElement) existingElement.remove();

            const root = ReactDOM.createRoot(container);
            root.render(element);

            document.head.appendChild(container);
        } else {
            // Do nothing, since the server already adds it.
        }

        return this;
    }

    public addToBodyBegin(key: string, entry: React.ReactNode) {
        if (this.isServerSide) {
            if (!this.checkKey("bb" + key)) return this;

            if (!this.state.bodyBegin) this.state.bodyBegin = [entry];
            else this.state.bodyBegin.push(entry);

            // Required to trigger a browser-side refresh of the body.
            this.onStateUpdated(this.state);
        }

        return this;
    }

    public addToBodyEnd(key: string, entry: React.ReactNode) {
        if (this.isServerSide) {
            if (!this.checkKey("be" + key)) return this;

            if (!this.state.bodyEnd) this.state.bodyEnd = [entry];
            else this.state.bodyEnd.push(entry);

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
}

export class PageController_ExposePrivate<T = any> extends PageController<T> {
    getOptions(): PageOptions {
        return this.state;
    }

    setServerRequest(serverRequest: ServerRequestInstance) {
        this.objectRegistry.setValue("jopi.serverRequest", serverRequest);

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