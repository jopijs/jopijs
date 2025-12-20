import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_term from "jopi-toolkit/jk_term";

interface IsPackageJson {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    workspaces?: string[];

    jopi?: {
        modDependencies?: string[];
    };
}

export class JopiModuleInfo {
    readonly modName: string;
    readonly modOrg?: string;

    private _npmName?: string;

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

    get npmName(): string {
        if (this._npmName) return this._npmName;

        if (this.modOrg) return this._npmName = "@" + this.modOrg + "/jopimod_" + this.modName;
        return this._npmName = "jopimod_" + this.modName;
    }

    private _packageJson: IsPackageJson|undefined|null = null;

    async getPackageJson(): Promise<IsPackageJson|undefined> {
        if (this._packageJson) return this._packageJson;

        const packageJsonFile = jk_fs.join(this.fullPath, "package.json");
        return this._packageJson = await jk_fs.readJsonFromFile<IsPackageJson>(packageJsonFile);
    }

    async getModDependencies(): Promise<string[]> {
        function cleanUpDependencyName(depName: string): string|undefined {
            if (depName.startsWith("mod_")) {
                depName = depName.substring(4);

                let idx = depName.indexOf("@");
                if (idx!==-1) return "jopimod_" + depName;

                let modOrg = depName.substring(0, idx);
                let modName = depName.substring(idx+1);

                return "@" + modOrg + "/jopimod_" + modName;
            }

            let idx = depName.indexOf("@");

            if (idx===0) {
                let idx = depName.indexOf("/");
                let modName = depName.substring(idx+1);
                if (!modName.startsWith("jopimod_")) return undefined;
                return depName;
            } else if (idx===-1) {
                if (!depName.startsWith("jopimod_")) return undefined;
                return depName;
            } else {
                let modOrg = depName.substring(0, idx);
                let modName = depName.substring(idx+1);

                return "@" + modOrg + "/jopimod_" + modName;
            }
        }

        function append (deps: string[]) {
            for (let d of deps) {
                let c = cleanUpDependencyName(d);
                if (c) allDeps.push(c);
            }
        }

        let pkgJson = await this.getPackageJson();
        if (!pkgJson) return [];

        let allDeps: string[] = [];

        if (pkgJson.jopi?.modDependencies) {
            append(pkgJson.jopi.modDependencies);
        }

        if (pkgJson.dependencies) {
            append(Object.keys(pkgJson.dependencies));
        } else if (pkgJson.devDependencies) {
            append(Object.keys(pkgJson.devDependencies));
        }

        return allDeps;
    }

    async removeNodeModulesDir() {
        let dir = jk_fs.join(this.fullPath, "node_modules");

        if (await jk_fs.isDirectory(dir)) {
            await jk_fs.rmDir(dir);
        }
    }

    async savePackageJson(newValue?: IsPackageJson): Promise<void> {
        if (!newValue) {
            if (this._packageJson) newValue = this._packageJson;
            else return;
        }

        this._packageJson = newValue;
        await jk_fs.writeTextToFile(jk_fs.join(this.fullPath, "package.json"), JSON.stringify(newValue, null, 4))
    }

    async checkPackageInfo() {
        let pkgJson = await this.getPackageJson();

        if (!pkgJson) {
            await this.savePackageJson({
                name: "jopimod_" + this.modName,
                version: "0.0.1",

                dependencies: {},
                devDependencies: {}
            });
        } else {
            let mustSave = false;
            const npmPkgName = this.npmName;

            if (!pkgJson.name || (pkgJson.name !== npmPkgName)) {
                pkgJson.name = npmPkgName;
                mustSave = true;
            }

            if (!pkgJson.version) {
                pkgJson.version = "0.0.1";
            }

            if (mustSave) {
                await this.savePackageJson();
            }
        }

        let allDeps = await this.getModDependencies();

        if (allDeps.length) {
            let modNames = Object.values(await getModulesList()).map(x => x.npmName);

            for (let dep of allDeps) {
                if (!modNames.includes(dep)) {
                    console.log(`⚠️  Module ${jk_term.textBlue(this.modName)} has a dependency to ${jk_term.textRed(dep)} which doesn't exist.`);
                }
            }
        }
    }
}

/**
 * Will check and update all the workspace things:
 * - package.json of the project:
 *      - Check that all modules are inside the workspaces.
 *      - Check that all modules in dependencies are valid.
 * - package.json of the modules: check his dependencies.
 *      - Check that all modules in dependencies are valid.
 *      - Remove extra node_modules folders.
 */
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
    }

    //endregion

    //region Check that all modules have a valid package.json

    for (let module of Object.values(modules)) {
        await module.checkPackageInfo();
        await module.removeNodeModulesDir();
    }

    //endregion

    if (hasAddedWkItems) {
        onProjectDependenciesAdded();
    }
}

/**
 * Returns the list of all modules in the project.
 */
export async function getModulesList(): Promise<Record<string, JopiModuleInfo>> {
    if (gModulesList) return gModulesList;

    const dirItems = await jk_fs.listDir(getProjectDir_src());
    let found: Record<string, JopiModuleInfo> = {};

    for (let dirItem of dirItems) {
        if (!dirItem.isDirectory) continue;
        if (!dirItem.name.startsWith("mod_")) continue;
        found[dirItem.name] = new JopiModuleInfo(dirItem.name, dirItem.fullPath);
    }

    return gModulesList = found;
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
let gModulesList: Record<string, JopiModuleInfo>|undefined;
let gProjectDependenciesAdded = false;