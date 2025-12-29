import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_tools from "jopi-toolkit/jk_tools";

import {
    type ProcessDirItemParams,
    getSortedDirItem,
    type TransformItemParams,
    PriorityLevel,
    type RegistryItem,
    AliasType,
    CodeGenWriter, priorityNameToLevel
} from "./engine.ts";

//region TypeList

export interface TypeList_Group extends RegistryItem {
    listName: string;
    allDirPath: string[];
    items: TypeList_GroupItem[];
    itemsType: string;
    conditions?: Set<string>;
}

export interface TypeList_GroupItem {
    ref?: string;
    entryPoint?: string;
    priority: PriorityLevel;
    sortKey: string;
}

export class TypeList extends AliasType {
    protected async onListItem(item: TypeList_GroupItem, list: TypeList_GroupItem[], _dirPath: string): Promise<void> {
        list.push(item);
    }

    protected mergeIntoList(list: TypeList_Group, items: TypeList_GroupItem[]) {
        let currentItems = list.items;
        currentItems.push(...items);
        currentItems.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    }

    async processDir(p: { moduleDir: string; typeDir: string; genDir: string; }) {
        await this.processList(p.typeDir);

        // >>> Add extra items to the list.

        let shadowList = this.getShadowLists();

        if (shadowList) {
            for (let listId of shadowList) {
                let current = this.registry_getItem<TypeList_Group>(listId, this);

                if (!current) {
                    const newItem: TypeList_Group = {
                        listName: listId, type: this,
                        itemPath: "", items: [], itemsType: "",
                        allDirPath: []
                    };

                    this.registry_addItem(this.typeName + "!" + listId, newItem);
                }
            }
        }
    }

    /**
     * Get the list which must be created in all case
     * even without a static declaration.
     */
    protected getShadowLists(): string[]|undefined {
        return undefined;
    }

    protected async processList(listDirPath: string): Promise<void> {
        await this.dir_recurseOnDir({
            dirToScan: listDirPath,
            expectFsType: "dir",

            rules: {
                nameConstraint: "canBeUid",
                requireRefFile: false,
                requirePriority: false,
                allowConditions: false,
                rootDirName: jk_fs.basename(listDirPath),
                transform: (p) => this.processGroup(p)
            }
        });
    }

    protected async processGroup(p: TransformItemParams) {
        let listId = this.typeName + "!" + p.itemName!;
        const listName = p.itemName;

        // > Extract the list items.

        const dirItems = await getSortedDirItem(p.itemPath);
        let listItems: TypeList_GroupItem[] = [];

        const params: ProcessDirItemParams = {
            rootDirName: p.parentDirName,
            nameConstraint: "canBeUid",
            requirePriority: false,
            requireRefFile: false,
            allowConditions: false,

            filesToResolve: {
                "entryPoint": ["index.tsx", "index.ts"]
            },

            transform: async (item) => {
                const listItem: TypeList_GroupItem = {
                    priority: item.priority,
                    sortKey: item.itemName,
                    ref: item.refTarget,
                    entryPoint: item.resolved.entryPoint
                };

                await this.onListItem(listItem, listItems, item.itemPath);
            }
        };

        for (let dirItem of dirItems) {
            if (!dirItem.isDirectory) continue;

            if (dirItem.name === "_") {
                let uid = jk_tools.generateUUIDv4();
                let newPath = jk_fs.join(jk_fs.dirname(dirItem.fullPath), uid);
                await jk_fs.rename(dirItem.fullPath, newPath);

                dirItem.name = uid;
                dirItem.fullPath = newPath;
            }

            if ((dirItem.name[0] === "_") || (dirItem.name[0] === ".")) continue;

            await this.dir_processItem(dirItem, params);
        }

        // > Add the list.

        let current = this.registry_getItem<TypeList_Group>(listId, this);

        if (!current) {
            const newItem: TypeList_Group = {
                listName, conditions: p.conditions,
                type: this, itemPath: p.itemPath,
                items: listItems, itemsType: p.parentDirName, allDirPath: [p.itemPath]
            };

            this.registry_addItem(listId, newItem);
        } else {
            if (current.itemsType !== p.parentDirName) {
                throw this.declareError(`The list ${listId} is already defined and has a different type: ${current.itemsType}`, p.itemPath);
            }

            // Merge the items into the current one.
            this.mergeIntoList(current, listItems);

            // The list of event declaration locations.
            current.allDirPath.push(p.itemPath);
        }
    }

    protected getGenOutputDir(_list: TypeList_Group) {
        return this.typeName;
    }

    protected resolveEntryPointFor(list: TypeList_Group, item: TypeList_GroupItem): string {
        let entryPoint = item.entryPoint!;

        if (!entryPoint) {
            let d = this.registry_requireItem<TypeInDirChunk_Item>(item.ref!);
            if (d.itemType!==list.itemsType) {
                throw this.declareError(`Type mismatch. Expect ${list.itemsType}`, d.itemPath)
            }

            if (!d.entryPoint) {
                throw this.declareError(`Item if missing index.ts/index.tsx file`, d.itemPath)
            }

            entryPoint = d.entryPoint;
        }

        return entryPoint;
    }

    async generateCodeForItem(writer: CodeGenWriter, key: string, rItem: RegistryItem) {
        function sortByPriority(items: TypeList_GroupItem[]): TypeList_GroupItem[] {
            function addPriority(priority: PriorityLevel) {
                let e = byPriority[priority];
                if (e) items.push(...e);
            }

            const byPriority: any = {};

            for (let item of items) {
                if (!byPriority[item.priority]) byPriority[item.priority] = [];
                byPriority[item.priority].push(item);
            }

            items = [];

            addPriority(PriorityLevel.veryHigh);
            addPriority(PriorityLevel.high);
            addPriority(PriorityLevel.default);
            addPriority(PriorityLevel.low);
            addPriority(PriorityLevel.veryLow);

            return items;
        }

        const list = rItem as TypeList_Group;
        list.items = sortByPriority(list.items);

        await this.generateCodeForList(writer, key, list);
    }

    protected async generateCodeForList(writer: CodeGenWriter, key: string, list: TypeList_Group): Promise<void> {
        let count = 1;
        let outDir_innerPath = this.getGenOutputDir(list);
        let outDir_fullPath = jk_fs.join(writer.dir.output_src, outDir_innerPath);

        let srcCode = writer.AI_INSTRUCTIONS + this.codeGen_generateImports();
        let distCode = srcCode;

        for (let item of list.items) {
            let entryPoint = this.resolveEntryPointFor(list, item);
            let relPath = jk_fs.getRelativePath(outDir_fullPath, entryPoint);

            srcCode += `import I${count} from "${writer.toPathForImport(relPath, false)}";\n`;
            distCode += `import I${count} from "${writer.toPathForImport(relPath, true)}";\n`;

            count++;
        }

        let array = "";
        let max = list.items.length;
        for (let i = 1; i <= max; i++) array += `I${i},`;

        let toAdd = "\n" + this.codeGen_generateExports("[" + array + "]", list.listName);
        srcCode += toAdd;
        distCode += toAdd;

        let fileName = key.substring(key.indexOf("!") + 1);
        const fileInnerPath = jk_fs.join(outDir_innerPath, fileName);

        await writer.writeCodeFile({
            fileInnerPath,
            declarationFile: this.codeGen_createDeclarationTypes(),
            srcFileContent: srcCode,
            distFileContent: distCode
        });

        this.onSourceFileAdded(fileInnerPath);
    }

    protected onSourceFileAdded(fileInnerPath: string) {
    }

    protected codeGen_generateImports() {
        return "";
    }

    protected codeGen_generateExports(listAsArray: string, listName: string) {
        return "export default " + listAsArray + ";";
    }

    /**
     * Allow creating content for the .d.ts file.
     * @protected
     */
    protected codeGen_createDeclarationTypes() {
        return `const list: any[]; export default list;`
    }
}

//endregion

//region TypeInDirChunk

export interface TypeInDirChunk_Item extends RegistryItem {
    entryPoint: string;
    itemType: string;

    conditions?: Set<string>;
    conditionsContext?: Record<string, any>;
    features?: Record<string, boolean>;
}

export class TypeInDirChunk extends AliasType {
    async onChunk(chunk: TypeInDirChunk_Item, key: string, _dirPath: string) {
        this.registry_addItem(key, chunk);
    }

    async processDir(p: { moduleDir: string; typeDir: string; genDir: string; }) {
        await this.dir_recurseOnDir({
            dirToScan: p.typeDir,
            expectFsType: "dir",

            rules: {
                rootDirName: jk_fs.basename(p.typeDir),
                nameConstraint: "canBeUid",
                requireRefFile: false,
                requirePriority: true,

                filesToResolve: {
                    //"info": ["info.json"],
                    "entryPoint": ["index.tsx", "index.ts"]
                },

                transform: async (props) => {
                    if (!props.resolved?.entryPoint) {
                        throw this.declareError("No 'index.ts' or 'index.tsx' file found", props.itemPath);
                    }

                    const chunk: TypeInDirChunk_Item = {
                        type: this,

                        entryPoint: props.resolved?.entryPoint,

                        conditions: props.conditions,
                        conditionsContext: props.conditionsContext,
                        features: props.features,

                        itemType: props.parentDirName,

                        itemPath: props.itemPath,
                        priority: props.priority
                    };

                    const key = this.typeName + "!" + props.itemName;
                    await this.onChunk(chunk, key, props.itemPath);
                }
            }
        });
    }

    async generateCodeForItem(writer: CodeGenWriter, key: string, item: TypeInDirChunk_Item) {
        let targetName = key.substring(key.indexOf("!") + 1);
        let outDir = jk_fs.join(writer.dir.output_src, this.getGenOutputDir(item));
        let entryPoint = jk_fs.getRelativePath(outDir, item.entryPoint);

        const theImports = this.generateImport(writer, entryPoint);
        const fileInnerPath = jk_fs.join(this.getGenOutputDir(item), targetName);

        await writer.writeCodeFile({
            fileInnerPath,
            srcFileContent: theImports.ts,
            distFileContent: theImports.js
        });

        this.onSourceFileAdded(fileInnerPath);
    }

    protected onSourceFileAdded(fileInnerPath: string) {
    }

    protected generateImport(writer: CodeGenWriter, entryPoint: string): {ts: string, js: string} {
        const ts = writer.AI_INSTRUCTIONS + `import C from "${writer.toPathForImport(entryPoint, false)}";\nexport default C;`;
        const js = writer.AI_INSTRUCTIONS + `import C from "${writer.toPathForImport(entryPoint, true)}";\nexport default C;`;
        return {ts, js};
    }

    protected getGenOutputDir(_chunk: TypeInDirChunk_Item) {
        return this.typeName;
    }
}

//endregion

//region TypeAsIsChunk

export default class TypeAsIsChunk extends AliasType {
    constructor(public readonly typeName: string, private readonly allowedExtensions: string[], public readonly position?: "root"|undefined) {
        super(typeName, position);
    }
    async processDir(p: { moduleDir: string; typeDir: string; genDir: string; }): Promise<void> {
        let dirItems = await jk_fs.listDir(p.typeDir);
        const priorityMap = this.createPriorityMap(dirItems);

        for (let dirItem of dirItems) {
            if (dirItem.isFile && this.isValidFile(dirItem)) {
                let name = jk_fs.basename(dirItem.name);
                let idx = name.lastIndexOf(".");
                name = name.slice(0, idx);

                let priority = priorityMap[name];

                this.registry_addItem(this.typeName + "|" + name, {
                    priority, itemPath: dirItem.fullPath, type: this
                });
            }
        }
    }

    protected isValidFile(dirItem: jk_fs.DirItem): boolean {
        let ext = jk_fs.extname(dirItem.name);
        return this.allowedExtensions.includes(ext);
    }

    protected getGenOutputDir(item: RegistryItem): string {
        return item.type.typeName;
    }

    async generateCodeForItem(writer: CodeGenWriter, key: string, item: RegistryItem): Promise<void> {
        let idx = key.indexOf("|");
        let itemName = key.slice(idx + 1);

        let outputDir = this.getGenOutputDir(item);
        let outDir = jk_fs.join(writer.dir.output_src, outputDir);
        let entryPoint = jk_fs.getRelativePath(outDir, item.itemPath);

        let srcCode = writer.AI_INSTRUCTIONS + `export * from "${writer.toPathForImport(entryPoint, false)}";`;
        let distCode = writer.AI_INSTRUCTIONS + `export * from "${writer.toPathForImport(entryPoint, true)}";`;

        await writer.writeCodeFile({
            fileInnerPath: jk_fs.join(outputDir, itemName),
            srcFileContent: srcCode,
            distFileContent: distCode
        });
    }

    private extractPriority(priority: string, filePath: string): PriorityLevel {
        let priorityLevel = priorityNameToLevel(priority);

        if (priorityLevel===undefined) {
            throw this.declareError("Invalide priority level", filePath);
        }

        return priorityLevel;
    }

    protected createPriorityMap(dirItems: jk_fs.DirItem[]): Record<string, PriorityLevel> {
        const priorityMap: Record<string, PriorityLevel> = {};

        for (let dirItem of dirItems) {
            if (dirItem.name.endsWith(".priority")) {
                let name = dirItem.name.slice(0, -9);
                let idx = name.indexOf(".");

                let componentName = name.slice(0, idx);

                let priority = name.slice(idx + 1);
                priorityMap[componentName] = this.extractPriority(priority, dirItem.fullPath);
            }
        }

        return priorityMap;
    }
}

//endregion