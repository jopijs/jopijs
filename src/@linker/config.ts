import type {LinkerConfig} from "./linkerEngine.ts";
import * as jk_app from "jopi-toolkit/jk_app";
import {TypeInDirChunk} from "./coreAliasTypes.ts";
import TypeEvents from "./typeEvents.ts";
import TypeUiComposite from "./typeUiComposite.ts";
import ModInstaller from "./modInstaller.ts";
import TypeRoutes from "./typeRoutes.ts";
import ModPackageJson from "./modPackageJson.ts";
import {TypeTranslation} from "./typeTranslation.ts";
import {TypeLib} from "./typeLib.ts";
import {TypeUI} from "./typeUI.ts";
import {TypeStyles} from "./typeStyles.ts";
import TypeServerEvents from "./typeServerEvents.ts";
import { TypeObjectProvider } from "./typeObjectProvider.ts";
import TypeServerActions from "./typeServerAction.ts";

// Here it's ASYNC.
let gServerInstallFileTemplate_TS = `__AI_INSTRUCTIONS
__HEADER

export default async function(registry: any, onWebSiteCreated: any) {
__BODY__FOOTER
}`;

let gServerInstallFileTemplate_JS = `__AI_INSTRUCTIONS
__HEADER

export default async function(registry, onWebSiteCreated) {
__BODY__FOOTER
}`;

// Here it's not async.
let gBrowserInstallFileTemplate_TS = `__AI_INSTRUCTIONS
__HEADER

export default function(registry: any) {
__BODY__FOOTER
    registry.events.sendEvent("app.init.ui", {myModule: registry});
}`;

let gBrowserInstallFileTemplate_JS = `__AI_INSTRUCTIONS
__HEADER

export default function(registry) {
__BODY__FOOTER
    registry.events.sendEvent("app.init.ui", {myModule: registry});
}`;

export function getDefaultLinkerConfig(): LinkerConfig {
    return {
        projectRootDir: jk_app.findRequiredPackageJsonDir(),

        templateForServer_TS: gServerInstallFileTemplate_TS,
        templateForServer_JS: gServerInstallFileTemplate_JS,
        templateForBrowser_TS: gBrowserInstallFileTemplate_TS,
        templateForBrowser_JS: gBrowserInstallFileTemplate_JS,

        aliasTypes: [
            new TypeRoutes("routes", "root"),

            new TypeInDirChunk("schemes"),
            new TypeInDirChunk("hooks"),
            new TypeInDirChunk("res"),
            new TypeObjectProvider("objectProviders"),
            new TypeServerActions("serverActions"),
            //
            new TypeUI("ui"),
            new TypeStyles("styles"),
            new TypeLib("lib"),
            new TypeUiComposite("uiComposites"),
            new TypeEvents("events"),
            new TypeServerEvents("server-events"),
            new TypeTranslation("translations")
        ],

        modulesProcess: [
            new ModInstaller(),
            new ModPackageJson()
        ]
    }
}