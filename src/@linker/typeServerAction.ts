import {TypeInDirChunk, type TypeInDirChunk_Item} from "./coreAliasTypes.ts";
import * as jk_fs from "jopi-toolkit/jk_fs";
import {CodeGenWriter, FilePart, InstallFileType, writeTextToFileIfMismatch} from "./linkerEngine.ts";
import { calcCryptedUrl } from "jopijs/generated";
import { normalizeNeedRoleConditionName } from "./common.ts";
import * as jk_app from "jopi-toolkit/jk_app";

interface TypeServerActions_Item extends TypeInDirChunk_Item {
    securityUid: string;
    isPageData?: boolean;
}

export default class TypeServerActions extends TypeInDirChunk {
    private serverActionCounter = 0;

    protected normalizeConditionName(condName: string, filePath: string, ctx: any | undefined): string | undefined {
        // Only accept role condition of type "allNeedRole_.cond".
        return normalizeNeedRoleConditionName(condName, filePath, ctx, ["ALL"]);
    }
    
    async onChunk(chunk: TypeInDirChunk_Item, key: string, _dirPath: string): Promise<void> {
        let serverActionItem = chunk as TypeServerActions_Item;
        serverActionItem.securityUid = calcCryptedUrl(key);
        this.registry_addItem(key, serverActionItem);
    }

    async beginGeneratingCode(writer: CodeGenWriter) {
        writer.genAddToInstallFile(InstallFileType.server, FilePart.imports, `import {exposeServerAction} from "jopijs/generated";`);
    }

    getGenOutputDir(item: TypeServerActions_Item) {
        // For pageData, the output directory is the page route.
        if (item.isPageData) return "pageDatas";
        return this.typeName;
    }
    
    async generateCodeForItem(writer: CodeGenWriter, key: string, serverActionItem: TypeServerActions_Item): Promise<void> {
        //region Switch server / browser side
        // Allows a server and a browser version.

        // For pageData, the server action name is the securityUid.
        let serverActionName = serverActionItem.isPageData ? serverActionItem.securityUid : key.substring(key.indexOf("!") + 1);
        
        const fileInnerPath = jk_fs.join(this.getGenOutputDir(serverActionItem), serverActionName, "index");

        // The main file allows automatically switching betweek server/browser vesion.
        // It uses a bundler feature where the word jBundler_ifServer is replaced by jBundler_ifBrowser
        // when compiling for the browser.
        //
        await writer.writeCodeFile({
            fileInnerPath,

            srcFileContent: writer.AI_INSTRUCTIONS + `import D from "./jBundler_ifServer.ts";
export default D;`,

            distFileContent: writer.AI_INSTRUCTIONS + `import D from "./jBundler_ifServer.js";
export default D;`,
        });

        //endregion

        //region PageData
        
        // Generate the file 'pageData.gen.ts' in the same directory as the page route.

        if (serverActionItem.isPageData) {
            const fileToWrite_TS = jk_fs.join(serverActionItem.itemPath, "usePageData.gen.ts");
            const fileToWrite_JS = jk_app.getCompiledFilePathFor(fileToWrite_TS, true);
            
            // > Typescript version

            const relPathForImport_TS = jk_fs.getRelativePath(
                serverActionItem.itemPath,
                jk_fs.join(writer.dir.output_src, fileInnerPath + ".ts")
            );

            const proxy_TS = `import S from ${JSON.stringify(relPathForImport_TS)};
import {createUsePageData} from "jopijs/ui";
export default createUsePageData(S);`
            
            await writeTextToFileIfMismatch(fileToWrite_TS, proxy_TS);

            // > Javascript version

            const relPathForImport_JS = jk_fs.getRelativePath(
                serverActionItem.itemPath,
                jk_fs.join(writer.dir.output_src, fileInnerPath + ".js")
            );

            const proxy_JS = `import S from ${JSON.stringify(relPathForImport_JS)};
import {createUsePageData} from "jopijs/ui";            
export default createUsePageData(S);`

            await writeTextToFileIfMismatch(fileToWrite_JS, proxy_JS);
        }

        //endregion

        //region Server side
        // On service side, we directly call the server action.

        let outDir_TS = jk_fs.join(writer.dir.output_src, this.getGenOutputDir(serverActionItem));
        let entryPoint = jk_fs.getRelativePath(jk_fs.join(outDir_TS, "index.ts"), serverActionItem.entryPoint);
        let importPath_TS = writer.toPathForImport(entryPoint, false);
        let importPath_JS = writer.toPathForImport(entryPoint, true);

        await writer.writeCodeFile({
            fileInnerPath: jk_fs.join(this.getGenOutputDir(serverActionItem), serverActionName, "jBundler_ifServer"),
            srcFileContent: writer.AI_INSTRUCTIONS + `import D from ${JSON.stringify(importPath_TS)};\nexport default D;`,
            distFileContent: writer.AI_INSTRUCTIONS + `import D from ${JSON.stringify(importPath_JS)};\nexport default D;`,
        });

        //endregion

        //region Browser side
        // On browser side, we use a proxy to call the server action.
        // genProxyCallServerAction va générer le proxy.

        let src = writer.AI_INSTRUCTIONS + `import {proxyServerAction} from "jopijs/ui";
export default proxyServerAction(${JSON.stringify(serverActionName)}, ${JSON.stringify(serverActionItem.securityUid)});`;

        await writer.writeCodeFile({
            fileInnerPath: jk_fs.join(this.getGenOutputDir(serverActionItem), serverActionName, "jBundler_ifBrowser"),
            srcFileContent: src,
            distFileContent: src,
        });

        //endregion

        //region Server install
        // Add to installServer.ts file

        entryPoint = jk_fs.getRelativePath(writer.dir.output_src, serverActionItem.entryPoint);
        importPath_TS = writer.toPathForImport(entryPoint, false);
        importPath_JS = writer.toPathForImport(entryPoint, true);

        const rolesConditions = serverActionItem.conditionsContext?.["ALL"] || [];
        const serverActionNumber = this.serverActionCounter++;

        writer.genAddToInstallFile(InstallFileType.server, FilePart.imports, {
            ts: `\nimport ServerAction_${serverActionNumber} from ${JSON.stringify(importPath_TS)};`,
            js: `\nimport ServerAction_${serverActionNumber} from ${JSON.stringify(importPath_JS)};`
        });
        
        writer.genAddToInstallFile(InstallFileType.server, FilePart.body,
            `\n    exposeServerAction(ServerAction_${serverActionNumber}, ${JSON.stringify(serverActionName)}, ${JSON.stringify(serverActionItem.securityUid)}, ${JSON.stringify(rolesConditions)});`);

        //endregion
    }
}