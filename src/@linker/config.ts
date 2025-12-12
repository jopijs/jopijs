import type {LinkerConfig} from "./engine.ts";
import * as jk_app from "jopi-toolkit/jk_app";
import {TypeChunk} from "./coreAliasTypes.ts";
import TypeEvents from "./typeEvents.ts";
import TypeUiComposite from "./typeUiComposite.ts";
import ModInstaller from "./modInstaller.ts";
import TypeRoutes from "./typeRoutes.ts";
import TypeTable from "./typeTable.ts";

// Here it's ASYNC.
let gServerInstallFileTemplate = `__AI_INSTRUCTIONS
__HEADER

export default async function(registry, onWebSiteCreated) {
__BODY__FOOTER
}`;

// Here it's not async.
let gBrowserInstallFileTemplate = `__AI_INSTRUCTIONS
__HEADER

export default function(registry) {
__BODY__FOOTER
    registry.events.sendEvent("app.init.ui", {myModule: registry});
}`;

export function getDefaultLinkerConfig(): LinkerConfig {
    return {
        projectRootDir: jk_app.findPackageJsonDir(),

        templateForServer: gServerInstallFileTemplate,
        templateForBrowser: gBrowserInstallFileTemplate,

        aliasTypes: [
            new TypeChunk("uiComponents"),
            new TypeChunk("schemes"),
            //
            new TypeUiComposite("uiComposites"),
            new TypeEvents("events"),
            new TypeRoutes("routes", "root"),
            new TypeTable("tables")
        ],

        modulesProcess: [
            new ModInstaller()
        ]
    }
}