import React from "react";
import {ucFirst} from "../helpers/index.ts";
import type {MenuTree} from "./interfaces.ts";
import {ModuleInitContext} from "jopijs/ui";
import * as jk_events from "jopi-toolkit/jk_events";

class MenuTreeBuilder {
    constructor(
                private menuName: string,
                private menuManager: MenuManager,
                private readonly root: MenuTree,
                public readonly offset = -1,
                public readonly parentItems?: MenuTree[]) {
    }

    sortAll() {
        function doSort(root: MenuTree) {
            if (!root.items) return;

            root.items.sort((a, b) => {
                const priorityA = a.priority || 0;
                const priorityB = b.priority || 0;
                return priorityB - priorityA;
            });

            for (let item of root.items) {
                doSort(item);
            }
        }

        doSort(this.root);
    }


    get value(): MenuTree {
        return this.root;
    }

    /**
     * Return a HierarchyBuilder on the selected item.

     * @param keys string[]
     *      Traverse the hierarchy to search the item with the corresponding key.
     *      If it doesn't exist, create it.
     */
    private selectItem(keys: string[]): MenuTreeBuilder {
        let keyOffset = 0;
        const maxKeyOffset = keys.length;
        if (!maxKeyOffset) return this;

        let selected = this.root;
        let selectedOffset = -1;
        let selectedParent = this.parentItems;

        let currentPath = [];

        while (true) {
            if (keyOffset === maxKeyOffset) {
                return new MenuTreeBuilder(
                    this.menuName, this.menuManager,
                    selected, selectedOffset, selectedParent
                );
            }

            const key = keys[keyOffset++];
            currentPath.push(key);

            if (!selected.items) selected.items = [];

            let isFound = false;
            selectedParent = selected.items;

            let entryOffset = 0;

            for (let entry of selected.items) {
                if (entry.key===key) {
                    selected = entry;
                    selectedOffset = entryOffset;
                    isFound = true;
                    break;
                }

                entryOffset++;
            }

            if (!isFound) {
                selectedOffset = selected.items!.length;
                selected.items!.push(selected = this.normalize({key}, currentPath));
            }
        }
    }

    private normalize(entry: MenuTree, keys: string[]): MenuTree {
        this.applyNormalizer(entry, keys);
        return entry;
    }

    private applyNormalizer(entry: MenuTree, keys: string[]) {
        if (this.menuManager.mustRemoveTrailingSlashes) {
            if (entry.url && entry.url.endsWith("/")) entry.url = entry.url.slice(0, -1);
        } else {
            if (entry.url && !entry.url.endsWith("/")) entry.url += "/";
        }

        entry = this.menuManager.applyOverrides(entry, this.menuName, keys);

        if (!entry.title) {
            if (entry.key) {
                entry.title = ucFirst(entry.key);
            }
        }

        if (entry.icon && (typeof(entry.icon)==="string")) {
            entry.icon = this.menuManager.getIconFromName(entry.icon);
        }

        if (entry.items) {
            for (let item of entry.items) {
                this.applyNormalizer(item, keys);
            }
        }
    }

    set(keys: string[], value: Omit<MenuTree, "key" | "items">) {
        let target = this.selectItem(keys);

        for (let p in value) {
            if (value.hasOwnProperty(p)) {
                (target.root as any)[p] = (value as any)[p];
            }
        }

        this.applyNormalizer(target.root, keys);
    }
}

type MenuBuilder = (menu: MenuTreeBuilder) => void;

export class MenuManager {
    private isInvalid = true;
    private allMenus: Record<string, MenuTreeBuilder> = {};
    private readonly menuBuilders: Record<string, MenuBuilder[]> = {};

    constructor(private readonly module: ModuleInitContext,
                public readonly mustRemoveTrailingSlashes: boolean,
                private readonly forceURL?: URL)
    {
        jk_events.addListener("app.user.infosUpdated", () => {
            this.invalidateMenus(true);
        });

        jk_events.addListener("app.router.locationUpdated", () => {
            this.updateActiveItems();
        });
    }

    private getUrlPathName(): string {
        let url = (this.forceURL || new URL(window.location.href)).pathname;
        if (!url.endsWith("/")) url += "/";
        return url;
    }

    getMenuItems(name: string): MenuTree[] {
        if (this.isInvalid) {
            this.buildAllMenu();
        }

        let menu = this.allMenus[name];

        if (!menu) {
            if (this.menuBuilders[name]) {
                this.buildAllMenu();
            }
        }

        if (menu) {
            const items = menu.value.items;
            if (!items) return [];
            return items as MenuTree[];
        }

        return [];
    }

    private isActiveItemSearched = false;

    private buildAllMenu() {
        function checkItem(item: MenuTree, breadcrumb: string[]) {
            if (item.title) {
                breadcrumb = breadcrumb ? [...breadcrumb, item.title!] : [item.title!];
            }

            if (item.breadcrumb===undefined) {
                item.breadcrumb = breadcrumb;
            }

            item.reactKey = "R" + (gReactKey++) + "_"

            if (item.items) {
                for (const child of item.items) {
                    checkItem(child, breadcrumb);
                }
            }
        }

        this.isInvalid = false;

        for (let menuName in this.menuBuilders) {
            let builders = this.menuBuilders[menuName];

            const menu = new MenuTreeBuilder(menuName, this, {key: menuName});
            this.allMenus[menuName] = menu;

            for (const builder of builders) {
                builder(menu);
                menu.sortAll();
            }

            checkItem(menu.value, []);
        }

        this.updateActiveItems();
    }

    private updateActiveItems() {
        this.isActiveItemSearched = true;

        //region Reset menu items

        function reset(item: MenuTree) {
            item.isActive = false;

            if (item.items) {
                for (const child of item.items) {
                    reset(child);
                }
            }
        }

        for (let menuName in this.allMenus) {
            // Will force rebuilding.
            const menu = this.getMenuItems(menuName);
            if (menu) menu.forEach(reset);
        }

        //endregion

        for (const menuName in this.allMenus) {
            this.searchMatchingMenuItem(menuName);
        }
    }

    public getMatchingMenuItem(forceRefresh: boolean = false): MenuTree|undefined {
        if (this.isInvalid) {
            this.buildAllMenu();
        }
        else if (!this.isActiveItemSearched || forceRefresh) {
            this.updateActiveItems();
        }

        return gMenuActiveItem;
    }

    private searchMatchingMenuItem(menuName?: string): MenuTree|undefined {
        function checkItem(item: MenuTree): boolean {
            item.isActive = false;
            let isActive = item.url===pathName;

            if (isActive) {
                matchingMenuItem = item;

                if (gMenuActiveItem!==item) {
                    gMenuActiveItem = item;
                    jk_events.sendEvent("app.menu.activeItemChanged", {menuName, menuItem: item});
                }
            }

            if (item.items) {
                for (const child of item.items) {
                    if (checkItem(child)) {
                        isActive = true;
                        break;
                    }
                }
            }

            item.isActive = isActive;
            return isActive;
        }

        let pathName = this.getUrlPathName();

        if (this.mustRemoveTrailingSlashes) {
            if (pathName.endsWith("/")) {
                pathName = pathName.slice(0, -1);
            }
        } else {
            if (!pathName.endsWith("/")) {
                pathName += "/";
            }
        }

        let matchingMenuItem: MenuTree|undefined;

        if (menuName) {
            const menu = this.allMenus[menuName];
            if (menu) checkItem(menu.value);
        } else {
            for (const key in this.allMenus) {
                const menu = this.allMenus[key];
                checkItem(menu.value);
            }
        }

        return matchingMenuItem;
    }

    addMenuBuilder(menuName: string, builder: (menu: MenuTreeBuilder) => void) {
        let builders = this.menuBuilders[menuName];
        if (!builders) this.menuBuilders[menuName] = [builder];
        else builders.push(builder);

        this.invalidateMenus();
    }

    invalidateMenus(force = false) {
        if (this.isInvalid) {
            if (!force) return;
        }

        this.isInvalid = true;
        this.allMenus = {};

        jk_events.sendEvent("app.menu.invalided", this);
    }

    getMenuOverride(menuName: string): MenuOverride {
        let ovr = this.menuOverrides[menuName];

        if (!ovr) {
            ovr = new MenuOverride();
            this.menuOverrides[menuName] = ovr;
        }

        return ovr;
    }

    private readonly menuOverrides: Record<string, MenuOverride> = {};

    applyOverrides(entry: MenuTree, menuName: string, keys: string[]) {
        let menu = this.menuOverrides[menuName];
        if (!menu) return entry;

        let fullPath = JSON.stringify(keys);
        return menu.resolve(entry, fullPath);
    }

    getIconFromName(iconName: string): React.FC|undefined {
        return this.module.getIconFromName(iconName);
    }
}

export class MenuOverride {
    map: Record<string, MenuOverrideEntry> = {};

    override(keys: string[], entry: MenuOverrideEntry) {
        let key = JSON.stringify(keys);
        let current = this.map[key];
        if (!current) this.map[key] = current = {};

        if (entry.icon!==undefined) current.icon = entry.icon;
        if (entry.title!==undefined) current.title = entry.title;
        if (entry.priority!==undefined) current.priority = entry.priority;
        if (entry.breadcrumb!==undefined) current.breadcrumb = entry.breadcrumb;
    }

    resolve(e: MenuTree, fullPath: string): MenuTree {
        let ovr = this.map[fullPath];

        if (ovr) {
            if (ovr.title!==undefined) {
                e.title = ovr.title;
            }

            if (ovr.icon!==undefined) {
                // @ts-ignore
                e.icon = ovr.icon;
            }

            if (ovr.priority!==undefined) {
                e.priority = ovr.priority;
            }

            if (ovr.breadcrumb!==undefined) {
                e.breadcrumb = ovr.breadcrumb;
            }
        }

        return e;
    }
}

export interface MenuOverrideEntry {
    title?: string;
    icon?: React.ReactNode;
    priority?: number;
    breadcrumb?: string[] | React.FunctionComponent<unknown>;
}

let gReactKey = 0;
let gMenuActiveItem: MenuTree|undefined;