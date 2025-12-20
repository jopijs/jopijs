import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_term from "jopi-toolkit/jk_term";

interface IsPackageJson {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    workspaces?: string[];
}

export class JopiModuleInfo {
    readonly modName: string;
    readonly modOrg?: string;

    constructor(name: string, public readonly fullPath: string) {
        if (name.startsWith("mod_")) name = name.substring(4);

        // Dir format for org is: mod_orgName@moduleName
        //
        if (name.includes("@")) {
            let idx = name.indexOf("@");
            this.modOrg = name.substring(0, idx);
            name = name.substring(idx+1);
        }

        this.modName = name;
    }

    async checkPackageInfo() {
        const packageJsonFile = jk_fs.join(this.fullPath, "package.json");

        let pkgJson = await jk_fs.readJsonFromFile<IsPackageJson>(packageJsonFile);

        if (!pkgJson) {
            const template = {
                name: "jopimod_" + this.modName,
                version: "0.0.1",

                dependencies: {},
                devDependencies: {}
            };

            await jk_fs.writeTextToFile(packageJsonFile, JSON.stringify(template, null, 4));
        } else {
            let mustSave = false;
            let npmPkgName: string;

            if (this.modOrg) {
                npmPkgName = this.modOrg + "/jopimod_" + this.modName;
            } else {
                npmPkgName = "jopimod_" + this.modName;
            }

            if (!pkgJson.name || (pkgJson.name !== npmPkgName)) {
                pkgJson.name = npmPkgName;
                mustSave = true;
            }

            if (!pkgJson.version) {
                pkgJson.version = "0.0.1";
            }

            if (mustSave) {
                await jk_fs.writeTextToFile(packageJsonFile, JSON.stringify(pkgJson, null, 4));
            }
        }
    }
}
 
export async function updateWorkspaces() {
    const modules = await getModulesList();

    //region Check that all modules are inside the workspaces field of package.json

    const allModNames = Object.keys(modules);
    const pkjJsonFile = jk_fs.join(getProjectDir_src(), "..", "package.json");

    let pkgJson = await jk_fs.readJsonFromFile<IsPackageJson>(pkjJsonFile);
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

    //endregion

    //region Check that all modules have a valid package.json

    for (let module of Object.values(modules)) {
        await module.checkPackageInfo();
    }

    //endregion
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