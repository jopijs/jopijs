import {MenuManager} from "./core.ts";
import {type ReactMenuItem} from "./interfaces.ts";
import {isServerSide} from "jopi-toolkit/jk_what";
import {_usePage, useEvent} from "jopijs/ui";
import {useState} from "react";

export function useMenuManager(): MenuManager {
    return _usePage().objectRegistry.getObject<MenuManager>("uikit.menuManager")!
}

export function useMatchingMenuItem(): ReactMenuItem|undefined {
    return useMenuManager().getMatchingMenuItem();
}

export function useMenu(name: string): ReactMenuItem[] {
    const menuManager = useMenuManager();
    if (isServerSide) return menuManager.getMenuItems(name);

    // Will refresh one menu change.
    const [_, setCount] = useState(0);

    useEvent(["app.menu.invalided", "app.menu.activeItemChanged"], () => {
        setCount(count => count + 1)
    });

    return menuManager.getMenuItems(name);
}