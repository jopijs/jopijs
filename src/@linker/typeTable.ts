import {TypeInDirChunk, type TypeInDirChunk_Item} from "./coreAliasTypes.ts";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_app from "jopi-toolkit/jk_app";
import {normalizeNeedRoleConditionName} from "./common.ts";
import {CodeGenWriter, FilePart, InstallFileType} from "./engine.ts";
import type {JNamedTableReader} from "jopi-toolkit/jk_data";
import { calcCryptedUrl } from "jopijs/generated";

interface TypeTable_Item extends TypeInDirChunk_Item {
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

export default class TypeTable extends TypeInDirChunk {
    private toExpose: TypeTable_Item[] = [];

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
        let dsItem: TypeTable_Item = chunk as TypeTable_Item;

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

    async generateCodeForItem(writer: CodeGenWriter, key: string, dsItem: TypeTable_Item): Promise<void> {
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

            let dsImpl: JNamedTableReader;

            // Calc the path of the file to import.
            let toImport = dsItem.entryPoint;
            if (!writer.mustUseTypeScript) toImport = jk_app.getCompiledFilePathFor(toImport);

            try {
                // Allows to known the data source schema.
                dsImpl = (await import(toImport)).default;
            } catch {
                throw this.declareError("Is not a valide data source.", dsItem.entryPoint);
            }

            let schema = dsImpl.schema;
            if (!schema) throw this.declareError("Is not a valide data source. Missing schema.", dsItem.entryPoint);

            let jsonSchema = schema.toJson();

            srcCode = writer.AI_INSTRUCTIONS;
            srcCode += `import {JNamedTableReader_HttpProxy} from "jopi-toolkit/jk_data";`;
            srcCode += `\nimport {schema as newSchema} from "jopi-toolkit/jk_schema";`;
            srcCode += `\n\nexport const dataSourceName = "${dsName}";`;

            srcCode += `\nexport const schema = newSchema(${JSON.stringify(jsonSchema.desc, null, 4)}, ${JSON.stringify(jsonSchema.schemaMeta, null, 4)});`;
            srcCode += `\nexport default new JNamedTableReader_HttpProxy(dataSourceName, "/_jopi/ds/${dsItem.securityUid}", schema)`;
            distCode = srcCode;

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