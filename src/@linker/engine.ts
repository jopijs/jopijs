import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_tools from "jopi-toolkit/jk_tools";
import * as jk_term from "jopi-toolkit/jk_term";
import * as jk_what from "jopi-toolkit/jk_what";
import * as jk_events from "jopi-toolkit/jk_events";
import * as jk_app from "jopi-toolkit/jk_app";
import { PriorityLevel } from "jopi-toolkit/jk_tools";
import { getModulesList, setModulesSourceDir } from "jopijs/modules";
import { JopiModuleInfo } from "../@modules/index.ts";
import { collector_begin, collector_end } from "./dataCollector.ts";
export { PriorityLevel } from "jopi-toolkit/jk_tools";
import { logLinker_performance, logLinker_registry } from "./_logs.ts";

//region Helpers

export async function resolveFile(dirToSearch: string, fileNames: string[]): Promise<string | undefined> {
    for (let fileName of fileNames) {
        let filePath = jk_fs.join(dirToSearch, fileName);

        if (await jk_fs.isFile(filePath)) {
            return filePath;
        }
    }

    return undefined;
}

export function declareLinkerError(message: string, filePath?: string): Error {
    jk_term.logBgRed("⚠️ Jopi Linker Error -", message, "⚠️");
    if (filePath) jk_term.logBlue("See:", jk_fs.pathToFileURL(filePath));
    process.exit(1);
}

export async function getSortedDirItem(dirPath: string): Promise<jk_fs.DirItem[]> {
    const items = await jk_fs.listDir(dirPath);
    return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function useCanonicalFileName(fileFullPath: string, expectedFileName: string): Promise<string> {
    let fileName = jk_fs.basename(fileFullPath);
    let newFullPath = jk_fs.join(jk_fs.dirname(fileFullPath), expectedFileName);

    if (fileName !== expectedFileName) {
        await jk_fs.rename(fileFullPath, newFullPath);
    }

    return newFullPath;
}

export async function addNameIntoFile(filePath: string, name: string = jk_fs.basename(filePath)) {
    await writeTextToFileIfMismatch(filePath, name);
}

/**
 * Write the file content only if the file is missing or his content is not the same.
 * Allows avoiding triggering a file change detection event.
 */
export async function writeTextToFileIfMismatch(filePath: string, content: string) {
    if (!await jk_fs.isFile(filePath)) {
        await jk_fs.writeTextToFile(filePath, content);
        return;
    }

    const currentContent = await jk_fs.readTextFromFile(filePath);
    if (currentContent === content) return;

    await jk_fs.writeTextToFile(filePath, content);
}

export function priorityNameToLevel(priorityName: string): PriorityLevel | undefined {
    priorityName = priorityName.toLowerCase();
    priorityName = priorityName.replace("-", "");
    priorityName = priorityName.replace("_", "");

    switch (priorityName) {
        case "default":
            return PriorityLevel.default;
        case "veryhigh":
            return PriorityLevel.veryHigh;
        case "high":
            return PriorityLevel.high;
        case "low":
            return PriorityLevel.low;
        case "verylow":
            return PriorityLevel.veryLow;
    }

    return undefined;
}

export async function decodePriority(priorityName: string, itemFullPath: string): Promise<PriorityLevel> {
    priorityName = priorityName.toLowerCase();
    priorityName = priorityName.replace("-", "");
    priorityName = priorityName.replace("_", "");

    switch (priorityName) {
        case "default.priority":
            await useCanonicalFileName(itemFullPath, priorityName)
            return PriorityLevel.default;
        case "veryhigh.priority":
            await useCanonicalFileName(itemFullPath, "very_high.priority")
            return PriorityLevel.veryHigh;
        case "high.priority":
            await useCanonicalFileName(itemFullPath, priorityName)
            return PriorityLevel.high;
        case "low.priority":
            await useCanonicalFileName(itemFullPath, priorityName)
            return PriorityLevel.low;
        case "verylow.priority":
            await useCanonicalFileName(itemFullPath, "very_low.priority")
            return PriorityLevel.veryLow;
    }

    throw declareLinkerError("Unknown priority name: " + jk_fs.basename(itemFullPath, ".priority"), itemFullPath);
}

//endregion

//region Registry

export interface RegistryItem {
    type: AliasType;
    itemPath: string;
    priority?: PriorityLevel;
}

let gRegistry: Record<string, RegistryItem> = {};

//endregion

//region Generating code

export enum FilePart {
    imports = "imports",
    body = "body",
    footer = "footer",
}

export enum InstallFileType { server, browser, both }

async function generateAll() {
    function applyTemplate(template: string, header: string, body: string, footer: string): string {
        if (!header) header = "";
        if (!footer) footer = "";
        if (!body) body = "";

        template = template.replace("__AI_INSTRUCTIONS", AI_INSTRUCTIONS);
        template = template.replace("__HEADER", header);
        template = template.replace("__BODY", body);
        template = template.replace("__FOOTER", footer);

        return template;
    }

    for (let type of Object.values(gTypesHandlers)) {
        await type.beginGeneratingCode(gCodeGenWriter);

        let items: RegistryItem[] = [];

        for (let key in gRegistry) {
            const item = gRegistry[key];

            if (item.type === type) {
                const eventData = {
                    codeWrite: gCodeGenWriter, key,
                    item, items, mustSkip: false
                };

                items.push(item);
                await jk_events.sendAsyncEvent("@jopi.linker.generateCode." + type.typeName, eventData);

                if (!eventData.mustSkip) {
                    await item.type.generateCodeForItem(gCodeGenWriter, key, item);
                }
            }
        }

        await type.endGeneratingCode(gCodeGenWriter, items);
    }

    for (let p of gModuleDirProcessors) {
        await p.generateCode(gCodeGenWriter);
    }

    let installerFile = applyTemplate(gServerInstallFileTemplate_TS, gServerInstallFile_TS[FilePart.imports], gServerInstallFile_TS[FilePart.body], gServerInstallFile_TS[FilePart.footer]);
    await writeTextToFileIfMismatch(jk_fs.join(gDir_outputSrc, "installServer.ts"), installerFile);
    gServerInstallFile_TS = {};

    installerFile = applyTemplate(gServerInstallFileTemplate_JS, gServerInstallFile_JS[FilePart.imports], gServerInstallFile_JS[FilePart.body], gServerInstallFile_JS[FilePart.footer]);
    await writeTextToFileIfMismatch(jk_fs.join(gDir_outputDst, "installServer.js"), installerFile);
    gServerInstallFile_JS = {};

    installerFile = applyTemplate(gBrowserInstallFileTemplate_TS, gBrowserInstallFile_TS[FilePart.imports], gBrowserInstallFile_TS[FilePart.body], gBrowserInstallFile_TS[FilePart.footer]);
    await writeTextToFileIfMismatch(jk_fs.join(gDir_outputSrc, "installBrowser.ts"), installerFile);
    gBrowserInstallFile_TS = {};

    installerFile = applyTemplate(gBrowserInstallFileTemplate_JS, gBrowserInstallFile_JS[FilePart.imports], gBrowserInstallFile_JS[FilePart.body], gBrowserInstallFile_JS[FilePart.footer]);
    await writeTextToFileIfMismatch(jk_fs.join(gDir_outputDst, "installBrowser.js"), installerFile);
    gBrowserInstallFile_JS = {};
}

interface WriteCodeFileParams {
    /**
     * The path into the directory .jopi-codegen
     */
    fileInnerPath: string;

    /**
     * What to write into this file.
     * Here it's: src/.jopi-codegen/fileInnerPath
     */
    srcFileContent: string;

    /**
     * What to write into this file.
     * Here it's: dist/.jopi-codegen/fileInnerPath
     */
    distFileContent?: string;

    /**
     * The content of the .d.ts file.
     */
    declarationFile?: string;
}

export class CodeGenWriter {
    public readonly mustUseTypeScript = gMustUseTypeScript;

    constructor(public readonly dir: Directories) {
    }

    /**
     * Allows creating a path compatible with import statements (linux path format)
     */
    toPathForImport(filePath: string, convertToJsExt: boolean): string {
        if (convertToJsExt) {
            let idx = filePath.lastIndexOf(".");
            if (idx !== -1) filePath = filePath.substring(0, idx) + ".js";
        }

        filePath = filePath.replace(/\\/g, "/");
        return filePath;
    }

    makePathRelativeToOutput(path: string) {
        return jk_fs.getRelativePath(this.dir.output_src, path);
    }

    async writeCodeFile(params: WriteCodeFileParams) {
        // The file must:
        // - Be a JavaScript file.
        // - Be written into ./src/.jopi-codegen
        // - Be written into ./dst/.jopi-codegen  (only with Node.js)

        await writeTextToFileIfMismatch(jk_fs.join(gDir_outputSrc, params.fileInnerPath + ".ts"), params.srcFileContent);

        if (params.distFileContent) {
            await writeTextToFileIfMismatch(jk_fs.join(gDir_outputDst, params.fileInnerPath + ".js"), params.distFileContent);
        }

        if (params.declarationFile) {
            await writeTextToFileIfMismatch(jk_fs.join(gDir_outputDst, params.fileInnerPath + ".d.ts"), params.declarationFile);
        }
    }

    genAddToInstallFile(who: InstallFileType, where: FilePart, content: string | { ts: string, js: string }) {
        let tsContent: string, jsContent: string;

        if (typeof content === "string") {
            tsContent = content;
            jsContent = content;
        } else {
            tsContent = content.ts;
            jsContent = content.js;
        }

        function addTo(group: Record<string, string>, c: string) {
            let part = group[where] || "";
            group[where] = part + c;
        }

        if (who === InstallFileType.both) {
            addTo(gServerInstallFile_TS, tsContent);
            addTo(gServerInstallFile_JS, jsContent);
            addTo(gBrowserInstallFile_TS, tsContent);
            addTo(gBrowserInstallFile_JS, jsContent);
        } else if (who === InstallFileType.server) {
            addTo(gServerInstallFile_TS, tsContent);
            addTo(gServerInstallFile_JS, jsContent);
        } else if (who === InstallFileType.browser) {
            addTo(gBrowserInstallFile_TS, tsContent);
            addTo(gBrowserInstallFile_JS, jsContent);
        }
    }

    public readonly AI_INSTRUCTIONS = AI_INSTRUCTIONS;
}

let gCodeGenWriter: CodeGenWriter;

let gServerInstallFile_TS: Record<string, string> = {};
let gServerInstallFile_JS: Record<string, string> = {};

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

let gBrowserInstallFile_TS: Record<string, string> = {};
let gBrowserInstallFile_JS: Record<string, string> = {};

// Here it's not async.
let gBrowserInstallFileTemplate_TS = `__AI_INSTRUCTIONS
__HEADER

export default function(registry: any) {
__BODY__FOOTER
}`;

let gBrowserInstallFileTemplate_JS = `__AI_INSTRUCTIONS
__HEADER

export default function(registry) {
__BODY__FOOTER
}`;

//endregion

//region Processing project

async function processProject() {
    await processAllModules();
    await generateAll();
}

async function processAllModules() {
    setModulesSourceDir(gDir_ProjectSrc);
    let modules = await getModulesList();

    for (let module of Object.values(modules)) {
        for (let p of gModuleDirProcessors) {
            await p.onBeginModuleProcessing(gCodeGenWriter, module);
        }

        await processThisModule(module.fullPath);

        for (let p of gModuleDirProcessors) {
            await p.onEndModuleProcessing(gCodeGenWriter, module);
        }
    }
}

async function processThisModule(moduleDir: string) {
    let dirItems = await jk_fs.listDir(moduleDir);
    let aliasRootDir: jk_fs.DirItem | undefined;

    for (let dirItem of dirItems) {
        if (!dirItem.isDirectory) continue;
        if (dirItem.name[0] !== "@") continue;
        if (dirItem.name == "@alias") { aliasRootDir = dirItem; continue; }

        let name = dirItem.name.substring(1);
        let type = gTypesHandlers[name];
        if (!type) throw declareLinkerError("Unknown alias type: " + name, dirItem.fullPath);

        if (type.position !== "root") continue;
        await type.processDir({ moduleDir, typeDir: dirItem.fullPath, genDir: gDir_outputSrc });
    }

    if (aliasRootDir) {
        dirItems = await jk_fs.listDir(aliasRootDir.fullPath);

        for (let dirItem of dirItems) {
            if (!dirItem.isDirectory) continue;

            let name = dirItem.name;
            let type = gTypesHandlers[name];
            if (!type) throw declareLinkerError("Unknown alias type: " + name, dirItem.fullPath);

            if (type.position === "root") continue;
            await type.processDir({ moduleDir, typeDir: dirItem.fullPath, genDir: gDir_outputSrc });
        }
    }
}

//endregion

//region Extensions

export abstract class AliasType {
    constructor(public readonly typeName: string, public readonly position?: "root" | undefined) {
    }

    public initialize(_aliasTypes: Record<string, AliasType>) {
    }

    abstract processDir(p: { moduleDir: string; typeDir: string; genDir: string; }): Promise<void>;

    declareError(message: string, filePath?: string): Error {
        return declareLinkerError(message, filePath);
    }

    //region Codegen

    generateCodeForItem(writer: CodeGenWriter, key: string, rItem: RegistryItem): Promise<void> {
        return Promise.resolve();
    }

    beginGeneratingCode(writer: CodeGenWriter): Promise<void> {
        return Promise.resolve();
    }

    endGeneratingCode(writer: CodeGenWriter, items: RegistryItem[]): Promise<void> {
        return Promise.resolve();
    }

    //endregion

    //region Processing dir

    /**
     * Process a directory containing item to process.
     *
     * ruleDir/itemType/newItem1
     *                 /newItem2
     *                    ^- we will iterate it
     *           ^-- we are here
     */
    async dir_recurseOnDir(p: ScanDirItemsParams) {
        const dirItems = await jk_fs.listDir(p.dirToScan);

        for (let entry of dirItems) {
            if ((entry.name[0] === ".") || (entry.name[0] === "_")) continue;

            if (p.expectFsType === "file") {
                if (entry.isFile) {
                    if (p.handler) await p.handler(entry, p.rules);
                    else if (p.rules) await this.dir_processItem(entry, p.rules);
                }
            } else if (p.expectFsType === "dir") {
                if (entry.isDirectory) {
                    if (p.handler) await p.handler(entry, p.rules);
                    else if (p.rules) await this.dir_processItem(entry, p.rules);
                }
            } else if (p.expectFsType === "fileOrDir") {
                if (p.handler) await p.handler(entry, p.rules);
                else if (p.rules) await this.dir_processItem(entry, p.rules);
            }
        }
    }

    /**
     * Process an item to process.
     * Will analyze it and extract common informations.
     *
     * ruleDir/itemType/newItem/...
     *                  ^-- we are here
     */
    async dir_processItem(dirItem: jk_fs.DirItem, p: ProcessDirItemParams) {
        const thisIsFile = dirItem.isFile;
        const thisFullPath = dirItem.fullPath;
        const thisName = dirItem.name;
        let thisNameAsUID: string | undefined;

        // The file / folder-name is a UUID4?
        let thisIsUUID = jk_tools.isUUIDv4(thisName);

        if (thisIsUUID) {
            if (p.nameConstraint === "mustNotBeUid") {
                throw declareLinkerError("The name must NOT be an UID", thisFullPath);
            }

            thisNameAsUID = thisName;
        } else {
            if (p.nameConstraint === "mustBeUid") {
                throw declareLinkerError("The name MUST be an UID", thisFullPath);
            }
        }

        // It's a file?
        if (thisIsFile) {
            // Process it now.
            await p.transform({
                itemName: thisName,
                uid: thisIsUUID ? thisName : undefined,
                priority: PriorityLevel.default,

                itemPath: thisFullPath, isFile: thisIsFile,
                parentDirName: p.rootDirName,

                resolved: {}
            });

            return;
        }

        // Will search references to config.json / index.tsx / ...
        //
        let resolved: Record<string, string | undefined> = {};
        //
        if (p.filesToResolve) {
            for (let key in p.filesToResolve) {
                resolved[key] = await resolveFile(thisFullPath, p.filesToResolve[key]);
            }
        }

        // Search the "uid.myuid" file, which allows knowing the uid of the item.
        //
        const result = await this.dir_extractInfos(thisFullPath, p);

        const myUid = result.myUid;
        const refTarget = result.refTarget;
        let priority = result.priority!;

        if (priority === undefined) {
            priority = PriorityLevel.default;

            if (p.requirePriority) {
                await addNameIntoFile(jk_fs.join(thisFullPath, "default.priority"), "default.priority");
            }
        }

        if (myUid) {
            // If itemUid already defined, then must match myUidFile.
            if (thisNameAsUID && (thisNameAsUID !== myUid)) {
                throw declareLinkerError("The UID in the .myuid file is NOT the same as the UID in the folder name", thisFullPath);
            }

            thisNameAsUID = myUid;
        }

        const transformParams = {
            itemName: thisName, uid: thisNameAsUID, refTarget,
            itemPath: thisFullPath, isFile: thisIsFile, resolved, priority,
            parentDirName: p.rootDirName,

            conditions: result.conditionsFound,
            conditionsContext: result.conditionsContext,
            features: result.features
        };

        await this.checkIfItemAccepted(transformParams);

        await p.transform(transformParams);
    }

    protected async checkIfItemAccepted(params: TransformItemParams): Promise<void> {
        if (this.isItemAccepted(params)) {
            await this.onItemAccepted(params);
        }
    }

    protected isItemAccepted(params: TransformItemParams): boolean {
        return !!(params.resolved && params.resolved.entryPoint);
    }

    /**
     * Is called when an item is accepted as an valide item.
     * Most of the time it's an item added to the registry.
     */
    protected async onItemAccepted(params: { itemPath: string, features?: Record<string, boolean | undefined> }): Promise<void> {
        return this.addDefaultFiles(params);
    }

    /**
     * Add default files to the item.
     * Is currently used to add the default enabled/disables state for features. Exemple: autoCache.enable
     */
    protected async addDefaultFiles(params: { itemPath: string, features?: Record<string, boolean | undefined> }): Promise<void> {
        let defaultFeatures = this.getDefaultFeatures();

        if (defaultFeatures) {
            if (!params.features) params.features = {};

            for (let featureName in defaultFeatures) {
                let current = params.features[featureName];

                if (current === undefined) {
                    params.features[featureName] = current = defaultFeatures[featureName];
                }

                if (current) await addNameIntoFile(jk_fs.join(params.itemPath, featureName + ".enable"));
                else await addNameIntoFile(jk_fs.join(params.itemPath, featureName + ".disable"));
            }
        }
    }

    /**
     * Analyze the content of a dir, extract information, and check rules.
     */
    protected async dir_extractInfos(dirPath: string, rules: DirAnalyzingRules, useThisUid?: string | undefined): Promise<ExtractDirectoryInfosResult> {
        const decodeFeature = async (dirItem: jk_fs.DirItem, ext: string): Promise<string> => {
            let featureName = dirItem.name.toLowerCase();
            featureName = featureName.slice(0, -ext.length);
            //
            featureName = featureName.replaceAll("-", "");
            featureName = featureName.replaceAll("_", "");

            let canonicalName = this.onFeatureFileFound(featureName);

            if (!canonicalName) {
                throw declareLinkerError("Unknown feature name: " + featureName, dirItem.fullPath);
            }

            dirItem.name = canonicalName + ext;
            dirItem.fullPath = await useCanonicalFileName(dirItem.fullPath, dirItem.name);

            return canonicalName;
        }

        const decodeCond = async (dirItem: jk_fs.DirItem): Promise<string> => {
            let condName = dirItem.name.toLowerCase();
            condName = condName.slice(0, -5);
            //
            condName = condName.replaceAll("-", "");
            condName = condName.replaceAll("_", "");

            if (!result.conditionsContext) result.conditionsContext = {};
            let canonicalName = this.normalizeConditionName(condName, dirItem.fullPath, result.conditionsContext);

            if (!canonicalName) {
                throw declareLinkerError("Unknown condition: " + condName, dirItem.fullPath);
            }

            dirItem.name = canonicalName + ".cond";
            dirItem.fullPath = await useCanonicalFileName(dirItem.fullPath, dirItem.name);

            return canonicalName;
        }

        async function checkDirItem(entry: jk_fs.DirItem) {
            if (entry.isSymbolicLink) return false;
            if (entry.name[0] === ".") return false;

            if (entry.isDirectory) {
                if (entry.name === "_") {
                    let uid = useThisUid || jk_tools.generateUUIDv4();
                    let newPath = jk_fs.join(jk_fs.dirname(entry.fullPath), uid);
                    await jk_fs.rename(entry.fullPath, newPath);

                    entry.name = uid;
                    entry.fullPath = newPath;
                }

                if (entry.name[0] == "_") return false;
            }
            else {
                if (entry.name === "_.myuid") {
                    let uid = useThisUid || jk_tools.generateUUIDv4();
                    await jk_fs.unlink(entry.fullPath);
                    entry.fullPath = jk_fs.join(jk_fs.dirname(entry.fullPath), uid + ".myuid");
                    entry.name = uid + ".myuid";

                    await writeTextToFileIfMismatch(entry.fullPath, uid);
                }

                if (entry.name[0] == "_") return false;

                if (entry.name.endsWith(".myuid")) {
                    if (result.myUid) {
                        throw declareLinkerError("More than one .myuid file found here", entry.fullPath);
                    }

                    result.myUid = entry.name.slice(0, -6);
                    await addNameIntoFile(entry.fullPath);
                }
                else if (entry.name.endsWith(".priority")) {
                    if (result.priority) {
                        throw declareLinkerError("More than one .priority file found here", entry.fullPath);
                    }

                    if (rules.requirePriority === false) {
                        throw declareLinkerError("A .priority file is NOT expected here", entry.fullPath);
                    }

                    await addNameIntoFile(entry.fullPath);
                    result.priority = await decodePriority(entry.name, entry.fullPath);
                }
                else if (entry.name.endsWith(".cond")) {
                    if (rules.allowConditions === false) {
                        throw declareLinkerError("A .cond file is NOT expected here", entry.fullPath);
                    }

                    if (!result.conditionsFound) result.conditionsFound = new Set<string>();
                    result.conditionsFound.add(await decodeCond(entry));

                    await addNameIntoFile(entry.fullPath);
                }
                else if (entry.name.endsWith(".ref")) {
                    if (result.refTarget) {
                        throw declareLinkerError("More than one .ref file found here", entry.fullPath);
                    }

                    if (rules.requireRefFile === false) {
                        throw declareLinkerError("A .ref file is NOT expected here", entry.fullPath);
                    }

                    result.refTarget = entry.name.slice(0, -4);

                    await addNameIntoFile(entry.fullPath);
                }
                else if (entry.name.endsWith(".disable")) {
                    if (rules.allowFeatures === false) {
                        throw declareLinkerError("A .disable file is NOT expected here", entry.fullPath);
                    }

                    if (!result.features) result.features = {};

                    let canonicalName = await decodeFeature(entry, ".disable");
                    result.features[canonicalName] = false;

                    entry.name = canonicalName + ".disable";
                    entry.fullPath = await useCanonicalFileName(entry.fullPath, entry.name);
                    await addNameIntoFile(entry.fullPath);
                }
                else if (entry.name.endsWith(".enable")) {
                    if (rules.allowFeatures === false) {
                        throw declareLinkerError("A .disable file is NOT expected here", entry.fullPath);
                    }

                    if (!result.features) result.features = {};

                    let canonicalName = await decodeFeature(entry, ".enable");
                    result.features[canonicalName] = true;

                    entry.name = canonicalName + ".enable";
                    entry.fullPath = await useCanonicalFileName(entry.fullPath, entry.name);
                    await addNameIntoFile(entry.fullPath);
                }

                return true;
            }
        }

        let result: ExtractDirectoryInfosResult = { itemPath: dirPath };

        const items = await getSortedDirItem(dirPath);

        for (let item of items) {
            await checkDirItem(item);
        }

        let defaultFeatures = this.getDefaultFeatures();

        if (defaultFeatures) {
            if (!result.features) result.features = {};

            for (let featureName in defaultFeatures) {
                let current = result.features[featureName];
                if (current === undefined) {
                    result.features[featureName] = defaultFeatures[featureName];
                }
            }
        }

        return result;
    }

    protected getDefaultFeatures(): Record<string, boolean> | undefined {
        return undefined;
    }

    protected normalizeConditionName(condName: string, filePath: string, ctx: any | undefined): string | undefined {
        return undefined;
    }

    protected onFeatureFileFound(featureName: string): string | undefined {
        return undefined;
    }

    //endregion

    //region Registry

    registry_addItem<T extends RegistryItem>(itemId: string, item: T) {
        // If already exists, then keep the one with greater priority.
        //
        if (gRegistry[itemId]) {
            let currentPriority = gRegistry[itemId]?.priority || PriorityLevel.default;
            let itemPriority = item.priority || PriorityLevel.default;

            if (currentPriority > itemPriority) {
                logLinker_registry.spam(w => {
                    const relPath = jk_fs.getRelativePath(gDir_ProjectSrc, item.itemPath);
                    w(`Item ${itemId} ignored`, { item: itemId, path: relPath })
                });

                return;
            }
        }

        logLinker_registry.info(w => {
            const relPath = jk_fs.getRelativePath(gDir_ProjectSrc, item.itemPath);
            w(`Item ${itemId} added`, { item: itemId, path: relPath })
        });

        gRegistry[itemId] = item;
    }

    registry_getItem<T extends RegistryItem>(key: string, requireType?: AliasType): T | undefined {
        const entry = gRegistry[key];
        if (requireType && entry && (entry.type !== requireType)) throw declareLinkerError("The item " + key + " is not of the expected type @" + requireType.typeName);
        return entry as T;
    }

    registry_requireItem<T extends RegistryItem>(key: string, requireType?: AliasType): T {
        if (!key) throw new Error("registry_requireItem: key is undefined");
        
        const entry = gRegistry[key];
        if (!entry) throw declareLinkerError("The item " + key + " is required but not defined");
        if (requireType && (entry.type !== requireType)) throw declareLinkerError("The item " + key + " is not of the expected type @" + requireType.typeName);
        return entry as T;
    }

    //endregion
}

export interface DirAnalyzingRules {
    requireRefFile?: boolean;
    allowConditions?: boolean;
    requirePriority?: boolean;
    allowFeatures?: boolean;
}

export interface ScanDirItemsParams {
    dirToScan: string;
    expectFsType: "file" | "dir" | "fileOrDir";

    /**
     * If defined, then will be called for each validated entry.
     */
    handler?: (item: jk_fs.DirItem, rules: ProcessDirItemParams | undefined) => Promise<void>;

    rules?: ProcessDirItemParams;
}

export interface ProcessDirItemParams extends DirAnalyzingRules {
    rootDirName: string;
    filesToResolve?: Record<string, string[]>;
    nameConstraint: "canBeUid" | "mustNotBeUid" | "mustBeUid";

    transform: (props: TransformItemParams) => Promise<void>;
}

export interface TransformItemParams {
    itemName: string;
    itemPath: string;
    isFile: boolean;

    uid?: string;
    refTarget?: string;

    conditions?: Set<string>;
    conditionsContext?: Record<string, any>;

    features?: Record<string, boolean>;

    parentDirName: string;
    priority: PriorityLevel;

    resolved: Record<string, string | undefined>;
}

export interface ExtractDirectoryInfosResult {
    //dirItems: jk_fs.DirItem[];
    itemPath: string;

    myUid?: string;
    priority?: PriorityLevel;
    refTarget?: string;

    conditionsFound?: Set<string>;
    conditionsContext?: Record<string, any>;
    features?: Record<string, boolean>;
}

export class ModuleDirProcessor {
    onBeginModuleProcessing(writer: CodeGenWriter, module: JopiModuleInfo): Promise<void> {
        return Promise.resolve();
    }

    onEndModuleProcessing(writer: CodeGenWriter, module: JopiModuleInfo): Promise<void> {
        return Promise.resolve();
    }

    generateCode(writer: CodeGenWriter): Promise<void> {
        return Promise.resolve();
    }
}

let gTypesHandlers: Record<string, AliasType> = {};
let gModuleDirProcessors: ModuleDirProcessor[] = [];

//endregion

//region Bootstrap

let gDir_ProjectRoot: string;
let gDir_ProjectSrc: string;
let gDir_ProjectDist: string;
let gDir_outputSrc: string;
let gDir_outputDst: string;
let gMustUseTypeScript: boolean;

export function getWriter(): CodeGenWriter {
    return gCodeGenWriter;
}

export function getBrowserInstallScript() {
    if (gMustUseTypeScript) return jk_fs.join(gDir_outputSrc, "installBrowser.ts");
    return jk_fs.join(gDir_outputDst, "installBrowser.js");
}

export function getServerInstallScript() {
    if (gMustUseTypeScript) return jk_fs.join(gDir_outputSrc, "installServer.ts");
    return jk_fs.join(gDir_outputDst, "installServer.js");
}

export function innerPathToAbsolutePath_src(innerPath: string): string {
    return jk_fs.join(gDir_outputSrc, innerPath);
}

/**
 * Allows detecting if the project is a TypeScript-only project.
 * Which means:
 * - We use bun.js and execute a TypeScript file.
 * - Or the same thing with a recent version of Node.js
 */
function detectIfMustUseTypeScript(_importMeta: any) {
    // Allow avoiding Node.js with direct TypeScript execution.
    if (jk_what.isNodeJS) return false;

    let mainFile = jk_app.getApplicationMainFile();
    if (!mainFile) return false;
    return mainFile.endsWith(".ts") || mainFile.endsWith(".tsx");
}

export interface Directories {
    project: string;
    project_src: string;
    project_dst: string;

    output_src: string;
    output_dist: string;
}


async function checkFilesModifiedSince(dirToScan: string, since: number): Promise<boolean> {
    const items = await jk_fs.listDir(dirToScan);

    for (const item of items) {
        if (item.name.startsWith(".")) continue;
        if (item.name.includes(".gen.")) continue;

        if (item.isDirectory) {
            if (await checkFilesModifiedSince(item.fullPath, since)) return true;
        } else if (item.isFile) {
            const stat = await jk_fs.getFileStat(item.fullPath);
            if (stat && stat.mtimeMs > since) return true;
        }
    }
    return false;
}

export async function compile(importMeta: any, config: LinkerConfig, isRefresh = false): Promise<void> {
    async function searchLinkerScript(): Promise<string | undefined> {
        let jopiLinkerScript = jk_fs.join(gDir_ProjectRoot, "dist", "jopi-linker.js");
        if (await jk_fs.isFile(jopiLinkerScript)) return jopiLinkerScript;

        if (jk_what.isBunJS) {
            jopiLinkerScript = jk_fs.join(gDir_ProjectSrc, "jopi-linker.ts");
            if (await jk_fs.isFile(jopiLinkerScript)) return jopiLinkerScript;
        }

        return undefined;
    }

    const logPerformanceEnd = logLinker_performance.beginInfo("Linker Execution");
    
    gMustUseTypeScript = detectIfMustUseTypeScript(importMeta);

    // Reset the registry in case of a second call to compile.
    gRegistry = {};

    gDir_ProjectRoot = config.projectRootDir ?? process.cwd();
    gDir_ProjectSrc = jk_fs.join(gDir_ProjectRoot, "src");
    gDir_ProjectDist = jk_fs.join(gDir_ProjectRoot, "dist");

    gDir_outputSrc = jk_fs.join(gDir_ProjectSrc, ".jopi-codegen");
    gDir_outputDst = jk_fs.join(gDir_ProjectDist, ".jopi-codegen");

    const timestampFile = jk_fs.join(gDir_outputSrc, ".last_run");
    let lastRun = 0;

    try {
        const content = await jk_fs.readTextFromFile(timestampFile);
        if (content) lastRun = parseInt(content, 10);
    } catch { }

    if (lastRun > 0) {
        if (process.env.JOPI_FORCE_LINKER === "1") {
            logLinker_performance.info("Linker forced by JOPI_FORCE_LINKER");
        } else {
            const hasChanged = await checkFilesModifiedSince(gDir_ProjectSrc, lastRun);
            
            if (!hasChanged) {
                logPerformanceEnd("Linker skipped (no changes)");
                return;
            }
        }
    }

    collector_begin();

    gCodeGenWriter = new CodeGenWriter({
            project: gDir_ProjectRoot,
            project_src: gDir_ProjectSrc,
            project_dst: gDir_ProjectDist,

            output_src: gDir_outputSrc,
            output_dist: gDir_outputDst
        });

        let jopiLinkerScript = await searchLinkerScript();
        if (jopiLinkerScript) await import(jopiLinkerScript);

        gServerInstallFileTemplate_TS = config.templateForServer_TS;
        gServerInstallFileTemplate_JS = config.templateForServer_JS;
        gBrowserInstallFileTemplate_TS = config.templateForBrowser_TS;
        gBrowserInstallFileTemplate_JS = config.templateForBrowser_JS;

        gTypesHandlers = {};

        for (let aType of config.aliasTypes) {
            gTypesHandlers[aType.typeName] = aType;
        }

        gModuleDirProcessors = [];

        for (let p of config.modulesProcess) {
            gModuleDirProcessors.push(p);
        }

        for (let aType of config.aliasTypes) {
            aType.initialize(gTypesHandlers);
        }

        // Avoid deleting the directory if it's a refresh.
        // Why? Because resource can be requested while the
        // refresh is occurring.
        //
        if (!isRefresh) {
            // Note: here we don't destroy the dist dir.
            await jk_fs.rmDir(gDir_outputSrc);
        }

        await processProject();


    await collector_end(gCodeGenWriter);

    await jk_fs.writeTextToFile(timestampFile, Date.now().toString());

    logPerformanceEnd();
}

export interface LinkerConfig {
    projectRootDir?: string;

    templateForBrowser_TS: string;
    templateForBrowser_JS: string;
    templateForServer_TS: string;
    templateForServer_JS: string;

    /**
     * Processor for an entry into the @alias folder.
     */
    aliasTypes: AliasType[];

    /**
     * Processor for the Jopi modules himself.
     */
    modulesProcess: ModuleDirProcessor[];
}

//endregion

export const AI_INSTRUCTIONS = `/*
This file is generated by Jopi.js. Do not modify it.
See file ARCHITECTURE.md at the root of the project for instructions.
*/
`;