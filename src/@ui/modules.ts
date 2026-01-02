// noinspection JSUnusedGlobalSymbols

import React from "react";
import * as jk_events from "jopi-toolkit/jk_events";
import { type UiUserInfos } from "./user.ts";
import { isServerSide } from "jopi-toolkit/jk_what";
import { type IsObjectRegistry } from "./objectRegistry.ts";
import { PageController } from "./pageController.ts";

export interface JopiUiApplication_Host {
    objectRegistry: IsObjectRegistry;

    getCurrentURL(): URL;
    getUserInfos(): UiUserInfos | undefined;
    mustRemoveTrailingSlashes: boolean;

    events: jk_events.EventGroup;
}

export interface ComponentAliasDef {
    alias: string;
    component: React.ComponentType<any>;
}

type UiInitializer = () => void;

/**
 * This class is what is sent as the default export function
 * of your module `uiInit.tsx`. It allows configuring things
 * allowing your plugin to initialize your UI.
 * 
 * * On the server side, it's executed for each page.
 * * On the browser side, it's executed for each browser refresh.
 */
export class JopiUiApplication {
    public readonly objectRegistry: IsObjectRegistry;
    public readonly events: jk_events.EventGroup;
    public readonly isBrowserSide: boolean = !isServerSide;
    protected readonly host: JopiUiApplication_Host;

    constructor(host?: JopiUiApplication_Host, extra?: ExtraPageParams | undefined) {
        gDefaultJopiUiApplication = this;

        if (!host) host = getDefaultPageController();
        this.host = host;

        this.objectRegistry = host.objectRegistry;
        this.events = host.events;

        if (extra) {
            for (let key in extra) {
                this.objectRegistry.setValue("jopi.server." + key, (extra as any)[key]);
            }
        }

        this.initialize();
    }

    protected initialize() {
        // Will be overridden.
    }
    protected finalize() {

    }


    get mustRemoveTrailingSlashes() {
        return this.host.mustRemoveTrailingSlashes = true;
    }

    getCurrentURL(): URL {
        return this.host.getCurrentURL();
    }

    addUiInitializer(priority: UiInitializer | jk_events.EventPriority, initializer?: UiInitializer | undefined) {
        this.events.addListener("app.init.ui", priority, initializer);
    }

    //region Users & Roles

    getUserInfos(): UiUserInfos | undefined {
        return this.host.getUserInfos();
    }

    getUserRoles(): string[] {
        let userInfos = this.getUserInfos();
        if (!userInfos) return [];
        return userInfos.roles || [];
    }

    userHasAllRoles(roles: string[]): boolean {
        if (roles.length === 0) return true;

        let userInfos = this.getUserInfos();
        if (!userInfos) return false;

        let userRoles = userInfos.roles;
        if (!userRoles) return false;

        return !!roles.every(role => userRoles.includes(role));
    }

    userHasOneOfThisRoles(roles: string[]): boolean {
        if (roles.length === 0) return true;

        let userInfos = this.getUserInfos();
        if (!userInfos) return false;

        let userRoles = userInfos.roles;
        if (!userRoles) return false;

        let found = roles.find(role => userRoles.includes(role));
        return (found !== undefined);
    }

    ifUserHasAllRoles(roles: string[], f: (userInfos: UiUserInfos) => void): void {
        if (this.userHasAllRoles(roles)) {
            f(this.getUserInfos()!);
        }
    }

    ifUserHasOneOfThisRoles(roles: string[], f: (userInfos: UiUserInfos) => void): void {
        if (this.userHasOneOfThisRoles(roles)) {
            f(this.getUserInfos()!);
        }
    }

    ifUserLoggedIn(f: (userInfos: UiUserInfos) => void) {
        let userInfos = this.getUserInfos();
        if (!userInfos) return;
        return f(userInfos);
    }

    ifNotUserLoggedIn(f: () => Promise<void>) {
        if (!this.getUserInfos()) f();
    }

    //endregion

    //region Resolving

    resolveIcon(iconName: string, icon: React.FC) {
        if (!this.iconMap) this.iconMap = {};
        this.iconMap[iconName] = icon;
    }

    addIconResolved(f: Name2ReactFcResolver) {
        if (this.iconResolvers === undefined) this.iconResolvers = [];
        this.iconResolvers.push(f);
    }

    getIconFromName(iconName: string): React.FC | undefined {
        if (this.iconMap !== undefined) {
            let f = this.iconMap[iconName];
            if (f) return f;
        }

        if (this.iconResolvers) {
            for (let resolver of this.iconResolvers) {
                let f = resolver(iconName);
                if (f) return f;
            }
        }

        return undefined;
    }

    private iconMap?: Record<string, React.FC> = {};
    private iconResolvers?: Name2ReactFcResolver[];

    //endregion
}

export type Name2ReactFcResolver = (iconName: string) => React.FC | undefined;

export interface ExtraPageParams {
    menuEntries: MenuItemForExtraPageParams[]
}

export interface MenuItemForExtraPageParams {
    menuName: string,
    keys: string[],
    url: string,

    title?: string,
    icon?: string,
    roles?: string[]

    priority?: number
}

export function getDefaultJopiUiApplication(): JopiUiApplication {
    return gDefaultJopiUiApplication;
}

// Note: keep it here because it must not be exposed.
function getDefaultPageController(): PageController {
    if (!gDefaultPageController) gDefaultPageController = new PageController();
    return gDefaultPageController!;
}

let gDefaultPageController: PageController | undefined;
let gDefaultJopiUiApplication: JopiUiApplication;