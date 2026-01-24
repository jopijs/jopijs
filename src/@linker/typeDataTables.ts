import {TypeInDirChunk, type TypeInDirChunk_Item} from "./coreAliasTypes.ts";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_app from "jopi-toolkit/jk_app";
import {normalizeNeedRoleConditionName} from "./common.ts";
import {CodeGenWriter, FilePart, InstallFileType} from "./engine.ts";
import type {JDataBinding} from "jopi-toolkit/jk_data";
import { calcCryptedUrl } from "jopijs/generated";

interface TypeDataTables_Item extends TypeInDirChunk_Item {
    /**
     * Must automatically expose this data source to the network?
     */
    mustExpose: boolean;

    /**
     * Must automatically build a proxy for this data source?
     */
    mustBuildProxy: boolean;

    /**
     * A UID allows exposing the service with an anonymous URL.
     */
    securityUid: string;
}

export default class TypeDataTables extends TypeInDirChunk {
    private toExpose: TypeDataTables_Item[] = [];

    protected getDefaultFeatures(): Record<string, boolean>|undefined {
        return {
            autoExpose: true,
            autoProxy: true
        };
    }

    protected onFeatureFileFound(featureName: string): string|undefined {
        featureName = featureName.toLowerCase();

        // autoExpose
        if (featureName === "autoexpose") return "autoExpose";
        if (featureName === "public") return "autoExpose";
        if (featureName === "expose") return "autoExpose";

        // autoProxy
        if (featureName === "autoproxy") return "autoProxy";
        if (featureName === "proxy") return "autoProxy";
        if (featureName === "genproxy") return "autoProxy";

        return undefined;
    }

    protected normalizeConditionName(condName: string, filePath: string, ctx: any|undefined): string|undefined {
        return normalizeNeedRoleConditionName(condName, filePath, ctx, ["READ", "WRITE"]);
    }

    async onChunk(chunk: TypeInDirChunk_Item, key: string, dirPath: string) {
        let securityUid = calcCryptedUrl(key);
        let dsItem: TypeDataTables_Item = chunk as TypeDataTables_Item;

        dsItem.securityUid = securityUid;

        // Must expose this data source to the network?
        dsItem.mustExpose = chunk.features?.["autoExpose"]===true;
        if (dsItem.mustExpose) this.toExpose.push(dsItem);

        dsItem.mustBuildProxy = chunk.features?.["autoProxy"]===true;

        this.registry_addItem(key, chunk);
    }

    async beginGeneratingCode(writer: CodeGenWriter) {
        if (!this.toExpose.length) return;

        writer.genAddToInstallFile(InstallFileType.server, FilePart.imports, `\nimport {exposeDataSource_Table} from "jopijs";`);

        let count = 0;

        for (let dsItem of this.toExpose) {
            count++;

            let dsName = jk_fs.basename(dsItem.itemPath);
            let relPath = writer.makePathRelativeToOutput(dsItem.entryPoint);
            let relPathTS = writer.toPathForImport(relPath, false);
            let relPathJS = writer.toPathForImport(relPath, true);

            writer.genAddToInstallFile(
                InstallFileType.server,
                FilePart.imports, {
                    ts: `\nimport DS_${count} from "${relPathTS}";`,
                    js: `\nimport DS_${count} from "${relPathJS}";`
                });

            writer.genAddToInstallFile(
                InstallFileType.server,
                FilePart.body,
                `\n    exposeDataSource_Table("${dsName}", "${dsItem.securityUid}", DS_${count}, ${JSON.stringify(dsItem.conditionsContext)});`
            );
        }
    }

    async generateCodeForItem(writer: CodeGenWriter, key: string, dsItem: TypeDataTables_Item): Promise<void> {
        let targetName = key.substring(key.indexOf("!") + 1);
        let outDir = jk_fs.join(writer.dir.output_src, this.getGenOutputDir(dsItem));
        let entryPoint = jk_fs.getRelativePath(jk_fs.join(outDir, "index.ts"), dsItem.entryPoint);
        let importPath = writer.toPathForImport(entryPoint, false);
        let dsName = jk_fs.basename(dsItem.itemPath);
        
        if (dsItem.mustBuildProxy) {
            // > The server and browser versions will not be the same here.
            //   The server version directly targets the datasource.
            //   While the browser version will use a proxy to use HTTP.

            // index.ts
            //
            await writer.writeCodeFile({
                fileInnerPath: jk_fs.join(this.getGenOutputDir(dsItem), targetName, "index"),

                srcFileContent: writer.AI_INSTRUCTIONS + `export * from "./jBundler_ifServer.ts";
import DEFAULT from "./jBundler_ifServer.ts";
export default DEFAULT;`,

                distFileContent: writer.AI_INSTRUCTIONS + `export * from "./jBundler_ifServer.js";
import DEFAULT from "./jBundler_ifServer.js";
export default DEFAULT;`,
            });

            //region jBundler_ifServer.ts

            let srcCode = writer.AI_INSTRUCTIONS + `
import {toDataTable} from "jopijs/generated";
import C from "${importPath}";
export default toDataTable(C, ${JSON.stringify(dsName)});`;

            importPath = writer.toPathForImport(entryPoint, true);

            let distCode = writer.AI_INSTRUCTIONS + `
import {toDataTable} from "jopijs/generated";
import C from "${importPath}";
export default toDataTable(C, ${JSON.stringify(dsName)});`;

            await writer.writeCodeFile({
                fileInnerPath: jk_fs.join(this.getGenOutputDir(dsItem), targetName, "jBundler_ifServer"),
                srcFileContent: srcCode,
                distFileContent: distCode
            });

            //endregion

            //region jBundler_ifBrowser.ts

            let dsImpl: JDataBinding;

            // Calc the path of the file to import.
            let toImport = dsItem.entryPoint;
            if (!writer.mustUseTypeScript) toImport = jk_app.getCompiledFilePathFor(toImport);

            try {
                // Allows to known informations data table.
                // Warning: here it requires the compiled version to exists.
                //
                dsImpl = (await import(toImport)).default;
            } catch {
                throw this.declareError("Is not a valide data source.", dsItem.entryPoint);
            }

            let schema = dsImpl.schema;
            if (!schema) throw this.declareError("Is not a valide data tables. Missing schema.", dsItem.entryPoint);

            let rowActions = dsImpl.rowActions;
            let checkRolesFunction = dsImpl.checkRoles;

            if (rowActions) {
                if (!checkRolesFunction) throw this.declareError("Is not a valide data tables. Missing checkRoles function.", dsItem.entryPoint);
            }
            
            let jsonSchema = schema.toJson();

            let srzHttpProxyParams: any = {
                schema: { desc: jsonSchema.desc, meta: jsonSchema.schemaMeta },
                apiUrl: `/_jopi/ds/${dsItem.securityUid}`,
                name: dsName
            };

            let handlers: Record<string, string> = {};
            if (checkRolesFunction) handlers["checkRoles"] = checkRolesFunction.toString();

            let srzActions = [];

            if (rowActions) {
                let offset = 0;

                for (const action of rowActions) {
                    let actionEntry: any = { title: action.title, name: action.name };
                    srzActions.push(actionEntry);
                    
                    if (action.preProcess || action.postProcess) {
                        if (action.preProcess) {
                            let name = "action_pre_" + offset;
                            actionEntry.preProcessName = name;
                            handlers[name] = action.preProcess.toString();
                        }

                        if (action.postProcess) {
                            let name = "action_post_" + offset;
                            actionEntry.postProcessName = name;
                            handlers[name] = action.postProcess.toString();
                        }


                        if (action.serverAction) {
                            actionEntry.hasServerAction = true;
                        }
                    }

                    offset++;
                }
            }

            //region Generate TypeScript code

            let szrHandlers = "{";

            for (let handlerName in handlers) {
                szrHandlers += `\n\n"${handlerName}": //@ts-ignore\n${handlers[handlerName]},`;
            }

            szrHandlers += "\n}";

            srcCode = writer.AI_INSTRUCTIONS;
            srcCode += `import {JDataBinding_HttpProxy, type JDataBinding_HttpProxyParams} from "jopi-toolkit/jk_data";`;
            srcCode += `\n\nconst srzHttpProxyParams = ${JSON.stringify(srzHttpProxyParams, null, 4)};`;
            srcCode += `\n\nconst srzActions: any = ${JSON.stringify(srzActions, null, 4)};`;
            srcCode += `\n\nconst szrHandlers: any = ${szrHandlers};`;

            srcCode += `\n\nconst actions = srzActions.map((a:any) => ({
    name: a.name,
    title: a.title,
    hasServerAction: a.hasServerAction,
    preProcess: a.preProcessName ? szrHandlers[a.preProcessName] : undefined,
    postProcess: a.postProcessName ? szrHandlers[a.postProcessName] : undefined,
}));

const proxyParams: JDataBinding_HttpProxyParams = {
    ...srzHttpProxyParams,
    rowActions: actions,
    checkRoles: szrHandlers.checkRoles
};`;

            srcCode += `\n\nexport default new JDataBinding_HttpProxy(proxyParams)`;

            //endregion

            //region Generate JavaScript code

            distCode = writer.AI_INSTRUCTIONS;
            distCode += `import {JDataBinding_HttpProxy} from "jopi-toolkit/jk_data";`;
            distCode += `\n\nconst srzHttpProxyParams = ${JSON.stringify(srzHttpProxyParams, null, 4)};`;
            distCode += `\n\nconst srzActions = ${JSON.stringify(srzActions, null, 4)};`;
            distCode += `\n\nconst szrHandlers = ${szrHandlers};`;

            distCode += `\n\nconst actions = srzActions.map((a) => ({
    name: a.name,
    title: a.title,
    hasServerAction: a.hasServerAction,
    preProcess: a.preProcessName ? szrHandlers[a.preProcessName] : undefined,
    postProcess: a.postProcessName ? szrHandlers[a.postProcessName] : undefined,
}));

const proxyParams = {
    ...srzHttpProxyParams,
    rowActions: actions,
    checkRoles: szrHandlers.checkRoles
};`;

            distCode += `\n\nexport default new JDataBinding_HttpProxy(proxyParams)`;

            //endregion

            await writer.writeCodeFile({
                fileInnerPath: jk_fs.join(this.getGenOutputDir(dsItem), targetName, "jBundler_ifBrowser"),
                srcFileContent: srcCode,
                distFileContent: distCode
            });

            //endregion
        } else {
            //region index.ts

            let srcCode = writer.AI_INSTRUCTIONS + `import C from "${importPath}";
export * from "${importPath}";
export default C;`;

            importPath = writer.toPathForImport(entryPoint, true);
            let distCode = writer.AI_INSTRUCTIONS + `import C from "${importPath}";
export * from "${importPath}";
export default C;`;

            await writer.writeCodeFile({
                fileInnerPath: jk_fs.join(this.getGenOutputDir(dsItem), targetName, "index"),
                srcFileContent: srcCode,
                distFileContent: distCode
            });

            //endregion
        }
    }
}