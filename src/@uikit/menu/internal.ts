import {MenuManager} from "./core.ts";
import {getDefaultModuleInitContext} from "jopijs/ui";

export function getDefaultMenuManager(): MenuManager {
    if (!gMenuManager) {
        let mustRemoveTrailingSlashes = (window as any)["__JOPI_OPTIONS__"].removeTrailingSlashes === true
        gMenuManager = new MenuManager(getDefaultModuleInitContext(), mustRemoveTrailingSlashes);
    }

    return gMenuManager;
}

let gMenuManager: MenuManager|undefined;