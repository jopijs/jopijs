import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_term from "jopi-toolkit/jk_term";
import { logModules } from "./_logs.ts";
import * as path from "node:path";

interface IsPackageJson {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    workspaces?: string[];

    jopi?: {
        modDependencies?: string[];

        /**
         * If true, the modules will not be added to the project workspaces.
         */
        ignoreWorkspaces?: boolean;
    };
}

class JopiItemInfo {
    constructor(public readonly fullPath: string) {
    }

    protected _packageJson: IsPackageJson|undefined|null = null;

    async getPackageJson(): Promise<IsPackageJson|undefined> {
        if (this._packageJson) return this._packageJson;

        const packageJsonFile = jk_fs.join(this.fullPath, "package.json");
        return this._packageJson = await jk_fs.readJsonFromFile<IsPackageJson>(packageJsonFile);
    }

    async getModDependencies(): Promise<string[]> {
        function append (deps: string[]) {
            for (let d of deps) {
                let c = toNpmModuleName(d);

                logModules.info((w) => {
                    w("dependency added", { originalName: d, convertedName: c });
                });

                if (c) allDeps.push(c);
            }
        }

        let pkgJson = await this.getPackageJson();
        //
        if (!pkgJson) {
            logModules.info((w) => {
                w("Package.json not found", { path: this.fullPath });
            });

            return [];
        }

        logModules.spam((w) => {
            w("Package.json found", { content: pkgJson });
        });

        let allDeps: string[] = [];

        if (pkgJson.jopi?.modDependencies) {
            logModules.spam((w) => {
                w("modDependencies found", { content: pkgJson!.jopi!.modDependencies });
            });
            
            append(pkgJson.jopi.modDependencies);
        }

        if (pkgJson.devDependencies) {
            logModules.spam((w) => {
                w("devDependencies found", { content: pkgJson!.devDependencies });
            });

            append(Object.keys(pkgJson.devDependencies));
        }

        return allDeps;
    }

    async savePackageJson(newValue?: IsPackageJson): Promise<void> {
        if (!newValue) {
            if (this._packageJson) newValue = this._packageJson;
            else return;
        }

        this._packageJson = newValue;
        await jk_fs.writeTextToFile(jk_fs.join(this.fullPath, "package.json"), JSON.stringify(newValue, null, 4))
    }
}

export class JopiProjectInfo extends JopiItemInfo {
    constructor(fullPath: string) {
        super(fullPath);
    }
}

export class JopiModuleInfo extends JopiItemInfo {
    readonly modName: string;
    readonly modOrg?: string;
    private _npmName?: string;

    constructor(name: string, public readonly fullPath: string) {
        super(fullPath);

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

    async removeNodeModulesDir() {
        let dir = jk_fs.join(this.fullPath, "node_modules");

        if (await jk_fs.isDirectory(dir)) {
            await jk_fs.rmDir(dir);
        }
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
            logModules.info((w) => {
                w("found dependencies", { value: allDeps });
            });

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
 * Convert the name of a module to a valid npm format.
 *
 * @param itemName The name of the module.
 *      Accepted formats are:
 *      - mod_???
 *      - mod_orgName@modName
 *      - @orgName/jopimod_modName
 *      - jopimod_modName
 *
 * @returns
 *      A valid npm module name or undefined if the name is not valid.
 */
export function toNpmModuleName(itemName: string): string|undefined {
    if (itemName.startsWith("mod_")) {
        itemName = itemName.substring(4);

        let idx = itemName.indexOf("@");
        if (idx===-1) return "jopimod_" + itemName;

        let modOrg = itemName.substring(0, idx);
        let modName = itemName.substring(idx+1);

        return "@" + modOrg + "/jopimod_" + modName;
    }

    let idx = itemName.indexOf("@");

    if (idx===0) {
        let idx = itemName.indexOf("/");
        let modName = itemName.substring(idx+1);
        if (!modName.startsWith("jopimod_")) return undefined;
        return itemName;
    } else if (idx===-1) {
        if (!itemName.startsWith("jopimod_")) return undefined;
        return itemName;
    } else {
        let modOrg = itemName.substring(0, idx);
        let modName = itemName.substring(idx+1);

        return "@" + modOrg + "/jopimod_" + modName;
    }
}

/**
 * Convert the name of a module to the name of the directory where it is stored.
 *
 * @param itemName The name of the module.
 *      Accepted formats are:
 *      - mod_???
 *      - mod_orgName@modName
 *      - @orgName/jopimod_modName
 *      - jopimod_modName
 *
 * @returns
 *      A valid module dit name or undefined if the name is not valid.
 */
export function toModDirName(itemName: string): string|undefined {
    if (itemName.startsWith("mod_")) {
        return itemName;
    } else if (itemName.startsWith("jopimod_")) {
        return itemName.substring(4);
    }

    if (itemName[0]!=="@") return undefined;

    let idx = itemName.indexOf("/");
    if (idx===-1) return undefined;

    let org = itemName.substring(1, idx);
    let modName = itemName.substring(idx+9);

    return "mod_" + org + "@" + modName;
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
    if (!pkgJson) pkgJson = {};
    
    if (!pkgJson.jopi?.ignoreWorkspaces) {

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

        const srcDir = getProjectDir_src();
        for (let item of wsItems) {
            let modName: string;
            let idx = item.lastIndexOf("/");
            if (idx === -1) modName = item;
            else modName = item.substring(idx + 1);

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

                const modInfo = modules[modName];
                const srcDir = getProjectDir_src();
                
                let relPath = path.relative(srcDir, modInfo.fullPath);
                relPath = relPath.split(path.sep).join("/");
                
                const newItem = "src/" + relPath;
                newWsItems.push(newItem);

                if (item !== newItem) needSavePkgJson = true;
            } else {
                newWsItems.push("src/" + modName);
            }
        }

        for (let modName of allModNames) {
            // Already found into the workspace?
            if (foundModules[modName]) continue;

            needSavePkgJson = true;
            hasAddedWkItems = true;

            foundModules[modName] = true;
            
            const modInfo = modules[modName];
            let relPath = jk_fs.relative(srcDir, modInfo.fullPath);
            relPath = relPath.split(path.sep).join("/");

            newWsItems.push("src/" + relPath);
        }

        //endregion

        if (needSavePkgJson) {
            pkgJson.workspaces = newWsItems;
            await jk_fs.writeTextToFile(pkjJsonFile, JSON.stringify(pkgJson, null, 4));
        }
     
        if (hasAddedWkItems) {
        onProjectDependenciesAdded();
    }
    }

    //endregion

    //region Check that all modules have a valid package.json

    for (let module of Object.values(modules)) {
        await module.checkPackageInfo();
        await module.removeNodeModulesDir();
    }

    //endregion
}

/**
 * Returns the list of all modules in the project.
 */
export async function getModulesList(): Promise<Record<string, JopiModuleInfo>> {
    if (gModulesList) return gModulesList;

    let dirItems = await jk_fs.listDir(getProjectDir_src());
    const toScan: string[] = [getProjectDir_src()];
    const ignoredGroups: string[] = [];

    for (let dirItem of dirItems) {
        if (!dirItem.isDirectory && !dirItem.isSymbolicLink) continue;
        
        if (dirItem.name.startsWith("modGroup_")) {
            const hasIgnore = await jk_fs.isFile(jk_fs.join(dirItem.fullPath, ".ignore"));
            
            if (hasIgnore) {
                ignoredGroups.push(dirItem.name);
                continue;                
            }
        
            toScan.push(dirItem.fullPath);
        }
    }

    let found: Record<string, JopiModuleInfo> = {};

    for (let scanDir of toScan) {
        dirItems = await jk_fs.listDir(scanDir);

        for (let dirItem of dirItems) {
            if (!dirItem.isDirectory && !dirItem.isSymbolicLink) continue;
            if (!dirItem.name.startsWith("mod_")) continue;

            const hasIgnore = await jk_fs.isFile(jk_fs.join(dirItem.fullPath, ".ignore"));

            if (hasIgnore) {
                const relPath = path.relative(getProjectDir_src(), dirItem.fullPath);
                ignoredGroups.push(relPath);
                continue;
            }

            found[dirItem.name] = new JopiModuleInfo(dirItem.name, dirItem.fullPath);
        }
    }

    await updateRootTsConfigExcludes(ignoredGroups);

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
        gProjectDir_src = jk_fs.join(jk_app.findRequiredPackageJsonDir(), "src");
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

/**
 * Update tsconfig.json file to excludes ignored modGroups.
 * Allows to don't compile them.
 * Why? Because the linker ignore them, doing that TypeScript emit compilation errors.
 */
async function updateRootTsConfigExcludes(ignoredMod: string[]) {
    const projectDirSrc = getProjectDir_src();

    for (const modRelPath of ignoredMod) {
        const fullPath = jk_fs.join(projectDirSrc, modRelPath);
        const gitIgnorePath = jk_fs.join(fullPath, ".gitignore");

        if (!(await jk_fs.isFile(gitIgnorePath))) {
            await jk_fs.writeTextToFile(gitIgnorePath, ".ignore");
        }
    }

    const rootDir = jk_fs.join(projectDirSrc, "..");
    const tsConfigPath = jk_fs.join(rootDir, "tsconfig.json");
    
    if (!(await jk_fs.isFile(tsConfigPath))) return;
    
    const tsConfig = await jk_fs.readJsonFromFile<any>(tsConfigPath);
    if (!tsConfig) return;

    let oldIgnored = JSON.stringify(tsConfig.exclude || []);
    tsConfig.exclude = ignoredMod.map(g => `./src/${g}`);
    let newIgnored = JSON.stringify(tsConfig.exclude || []);

    if (oldIgnored!==newIgnored) {
        await jk_fs.writeTextToFile(tsConfigPath, JSON.stringify(tsConfig, null, 2));
    }
}