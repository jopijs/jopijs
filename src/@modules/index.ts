import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_term from "jopi-toolkit/jk_term";

export class JopiModuleInfo {
    constructor(public readonly name: string, public readonly fullPath: string) {
    }

    async checkPackageInfo() {
        const packageJsonFile = jk_fs.join(this.fullPath, "package.json");

        if (!await jk_fs.isFile(packageJsonFile)) {
            const template = {
                name: "jopimod_" + jk_fs.basename(this.name),
                version: "0.0.1",

                dependencies: {},
                devDependencies: {}
            };

            await jk_fs.writeTextToFile(packageJsonFile, JSON.stringify(template, null, 4));
        }
    }
}
 
export async function updateWorkspaces() {
    const modules = await getModulesList();
    const allModNames = Object.keys(modules);
    const pkjJsonFile = jk_fs.join(getProjectDir_src(), "..", "package.json");

    let pkgJson = await jk_fs.readJsonFromFile<{workspaces?: string[]}>(pkjJsonFile);
    if(!pkgJson) pkgJson = {};

    //region Get workspace items

    let wsItems: string[];

    if (!pkgJson.workspaces) {
        pkgJson.workspaces = [];
        wsItems = [];
    } else {
        wsItems = pkgJson.workspaces;
    }

    //endregion

    //region Add modules into the workspace

    let newWsItems: string[] = [];
    let foundModules: Record<string, boolean> = {};
    let needSavePkgJson = false;
    let hasAddedWkItems = false;

    for (let item of wsItems) {
        let modName: string;
        let idx = item.lastIndexOf("/");
        if (idx===-1) modName = item;
        else modName = item.substring(idx+1);

        if (modName.startsWith("mod_")) {
            if (!allModNames.includes(modName)) {
                // Is a module but doesn't exist anymore?
                needSavePkgJson = true;
                continue;
            }

            // Avoid double.
            if (foundModules[modName]) {
                needSavePkgJson = true;
                continue;
            }

            foundModules[modName] = true;
        }

        newWsItems.push("src/" + modName);
    }

    for (let modName of allModNames) {
        // Already found into the workspace?
        if (foundModules[modName]) continue;

        needSavePkgJson = true;
        hasAddedWkItems = true;

        foundModules[modName] = true;
        newWsItems.push("src/" + modName);
    }

    //endregion

    if (needSavePkgJson) {
        pkgJson.workspaces = newWsItems;
        await jk_fs.writeTextToFile(pkjJsonFile, JSON.stringify(pkgJson, null, 4));

        if (hasAddedWkItems) {
            onProjectDependenciesAdded();
        }
    }
}

export async function getModulesList(): Promise<Record<string, JopiModuleInfo>> {
    const dirItems = await jk_fs.listDir(getProjectDir_src());
    let found: Record<string, JopiModuleInfo> = {};

    for (let dirItem of dirItems) {
        if (!dirItem.isDirectory) continue;
        if (!dirItem.name.startsWith("mod_")) continue;
        found[dirItem.name] = new JopiModuleInfo(dirItem.name, dirItem.fullPath);
    }

    return found;
}

/**
 * Is called when dependencies have been added to the projets.
 * - By directly adding something.
 * - Or by updating the workspace.
 */
export function onProjectDependenciesAdded() {
    gProjectDependenciesAdded = true;

    // Avoid doing two calls.
    setTimeout(() => {
        if (gProjectDependenciesAdded) {
            gProjectDependenciesAdded = false;
            console.log(`${jk_term.textBgRed("\n!!!!!! Warning - Dependencies has been added !!!!!!")}\n!!!!!! You must run ${jk_term.textBlue("npm install")} to install them.`);
        }
    }, 500);
}

let gProjectDependenciesAdded = false;

function getProjectDir_src() {
    if (!gProjectDir_src) {
        gProjectDir_src = jk_fs.join(jk_app.findPackageJsonDir(), "src");
    }

    return gProjectDir_src;
}

export function setProjectRootDir(dir: string) {
    gProjectDir_src = jk_fs.join(dir, "src");
}

export function setModulesSourceDir(dir: string) {
    gProjectDir_src = dir;
}

let gProjectDir_src: string|undefined;