import {TypeInDirChunk, type TypeInDirChunk_Item} from "./coreAliasTypes.ts";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_app from "jopi-toolkit/jk_app";
import {normalizeNeedRoleConditionName} from "./common.ts";
import {CodeGenWriter, FilePart, InstallFileType} from "./engine.ts";
import type {JopiDataTable} from "jopi-toolkit/jk_data";
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

        writer.genAddToInstallFile(InstallFileType.server, FilePart.imports, `\nimport {exposeDataSource_Table} from "jopijs/core";`);

        let count = 0;

        for (let dsItem of this.toExpose) {
            count++;

            let dsName = jk_fs.basename(dsItem.itemPath);
            let importPath = "@/dataTables/" + dsName;
            
            writer.genAddToInstallFile(
                InstallFileType.server,
                FilePart.imports, {
                    ts: `\nimport DS_${count} from "${importPath}";`,
                    js: `\nimport DS_${count} from "${importPath}";`
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
        
        const browserActionsSrc = jk_fs.join(jk_fs.dirname(dsItem.entryPoint), "actionsBrowser.ts");
        const hasBrowserActions = await jk_fs.isFile(browserActionsSrc);
        const serverActionsSrc = jk_fs.join(jk_fs.dirname(dsItem.entryPoint), "actionsServer.ts");
        const hasServerActions = await jk_fs.isFile(serverActionsSrc);

        if (!hasBrowserActions) {
            const srcCode = 
            await jk_fs.writeTextToFile(browserActionsSrc, `import type { JopiTableBrowserActions } from "jopi-toolkit/jk_data";
const actions: JopiTableBrowserActions = {};
export default actions;`);

            await jk_fs.writeTextToFile(jk_app.getCompiledFilePathFor(browserActionsSrc), `const actions = {};
export default actions;`);
        }

        if (!hasServerActions) {
            await jk_fs.writeTextToFile(serverActionsSrc, `import type { JopiTableServerActions } from "jopijs/core";
const actions: JopiTableServerActions = {};
export default actions;`);

            await jk_fs.writeTextToFile(jk_app.getCompiledFilePathFor(serverActionsSrc), `const actions = {};
export default actions;`);
        }

        const outputDir = jk_fs.join(this.getGenOutputDir(dsItem), targetName);
        
        if (dsItem.mustBuildProxy) {
            // > The server and browser versions will not be the same here.
            //   The server version directly targets the datasource.
            //   While the browser version will use a proxy to use HTTP.

            // index.ts
            //
            await writer.writeCodeFile({
                fileInnerPath: jk_fs.join(this.getGenOutputDir(dsItem), targetName, "index"),

                srcFileContent: writer.AI_INSTRUCTIONS + `import DEFAULT from "./jBundler_ifServer.ts";
export default DEFAULT;`,

                distFileContent: writer.AI_INSTRUCTIONS + `import DEFAULT from "./jBundler_ifServer.js";
export default DEFAULT;`,
            });

            //region jBundler_ifServer.ts

            let serverActionsImportTS = "";
            let serverActionsMerge = "";
            let serverActionsImportJS = "";

            let saPathTS = writer.toPathForImport(writer.makePathRelativeToOutput(serverActionsSrc, outputDir), false);
            serverActionsImportTS = `import serverActions from "${saPathTS}";`;
            
            let saPathJS = writer.toPathForImport(writer.makePathRelativeToOutput(serverActionsSrc, outputDir), true);
            serverActionsImportJS = `import serverActions from "${saPathJS}";`;
            serverActionsMerge = `, serverActions`;

            let srcCode = writer.AI_INSTRUCTIONS + `
import {toDataTable} from "jopijs/generated";
import C from "${importPath}";
${serverActionsImportTS}

export default toDataTable(C, ${JSON.stringify(dsName)}${serverActionsMerge});`;

            importPath = writer.toPathForImport(entryPoint, true);

            let dstCode = writer.AI_INSTRUCTIONS + `
import {toDataTable} from "jopijs/generated";
import C from "${importPath}";
${serverActionsImportJS}

export default toDataTable(C, ${JSON.stringify(dsName)}${serverActionsMerge});`;

            await writer.writeCodeFile({
                fileInnerPath: jk_fs.join(this.getGenOutputDir(dsItem), targetName, "jBundler_ifServer"),
                srcFileContent: srcCode,
                distFileContent: dstCode
            });

            //endregion

            //region jBundler_ifBrowser.ts

            let dsImpl: JopiDataTable;

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
            
            let jsonSchema = schema.toJson();

            let httpProxyParams: any = {
                schema: { desc: jsonSchema.desc, meta: jsonSchema.schemaMeta },
                apiUrl: `/_jopi/ds/${dsItem.securityUid}`,
                actions: dsImpl.actions,
                name: dsName
            };

            //region Generate TypeScript code

            srcCode = writer.AI_INSTRUCTIONS;
            srcCode += `import {toDataTableProxy} from "jopi-toolkit/jk_data";`;
            
            let extraParams = "";

            let baPath = writer.toPathForImport(writer.makePathRelativeToOutput(browserActionsSrc, outputDir), false);
            srcCode += `\nimport browserActions from "${baPath}";`;
            extraParams = ", browserActions";

            srcCode += `\n\nconst httpProxyParams = ${JSON.stringify(httpProxyParams, null, 4)};`;
            srcCode += `\n\nexport default toDataTableProxy(httpProxyParams${extraParams})`;
            
            dstCode = srcCode;

            //endregion

            await writer.writeCodeFile({
                fileInnerPath: jk_fs.join(outputDir, "jBundler_ifBrowser"),
                srcFileContent: srcCode,
                distFileContent: dstCode
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