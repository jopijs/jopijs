import { TypeInDirChunk, type TypeInDirChunk_Item } from "./coreAliasTypes.ts";
import * as jk_fs from "jopi-toolkit/jk_fs";
import { CodeGenWriter, declareLinkerError, useCanonicalFileName } from "./linkerEngine.ts";

enum MergeType {
    DontMerge = 0,
    MergeClass = 1,
    MergeInterface = 2
}

interface TypeLibItem extends TypeInDirChunk_Item {
    mergeType: MergeType;
}

export class TypeLib extends TypeInDirChunk {
    allOverrides: Record<string, TypeLibItem[]> = {};

    async onChunk(chunk: TypeLibItem, key: string, dirPath: string) {
        async function tryMerge(dirItem: jk_fs.DirItem, newMergeType: MergeType, expectedFileName: string) {
            if (mergeType !== MergeType.DontMerge) {
                throw declareLinkerError("A merge file is already defined", dirItem.fullPath);
            }

            mergeType = newMergeType;

            if (dirItem.name !== expectedFileName) {
                await useCanonicalFileName(dirItem.fullPath, expectedFileName);
            }
        }

        let dirItems = await jk_fs.listDir(dirPath);
        let mergeType: MergeType = MergeType.DontMerge;

        for (let dirItem of dirItems) {
            if (!dirItem.isFile) continue;

            if (dirItem.name.endsWith(".merge")) {
                if (dirItem.name.startsWith("cla")) {
                    await tryMerge(dirItem, MergeType.MergeClass, "class.merge");
                } else if (dirItem.name.startsWith("int")) {
                    await tryMerge(dirItem, MergeType.MergeInterface, "interface.merge");
                }
            }
        }

        chunk.mergeType = mergeType;

        let group = this.allOverrides[key];

        if (!group) {
            this.allOverrides[key] = [chunk];
        } else {
            group.push(chunk);
        }

        // Allow the key to exist; doing that, `generateCodeForItem` will be called.
        return super.onChunk(chunk, key, dirPath);
    }

    async generateCodeForItem(writer: CodeGenWriter, key: string, item: TypeLibItem): Promise<void> {
        let overrides = this.allOverrides[key];

        // If not override, then generate the code normally.
        if (overrides.length <= 1) return super.generateCodeForItem(writer, key, item);

        let mustMerge = false;
        //
        for (let override of overrides) {
            if (override.mergeType !== MergeType.DontMerge) {
                mustMerge = true;
                break;
            }
        }
        //
        if (!mustMerge) return super.generateCodeForItem(writer, key, item);

        // Sort overrides by priority (lowest first)
        overrides.sort((a, b) => (a.priority || 0) - (b.priority || 0));

        const outDir = jk_fs.join(writer.dir.output_src, this.getGenOutputDir(item));

        let allImports = { ts: writer.AI_INSTRUCTIONS, js: writer.AI_INSTRUCTIONS };
        let body = "";

        let i = 0;

        for (let override of overrides) {
            i++;
            let entryPoint = jk_fs.getRelativePath(outDir, override.entryPoint);

            allImports.ts += `import C${i} from "${writer.toPathForImport(entryPoint, false)}";\n`;
            allImports.js += `import C${i} from "${writer.toPathForImport(entryPoint, true)}";\n`;

            body += `, C${i}`;
        }

        switch (item.mergeType) {
            case MergeType.MergeInterface:
                body = "interface D extends " + body.substring(1) + " {}";
                break;
            case MergeType.MergeClass:
                body = "class D extends " + body.substring(1) + " {}";
                break;
        }

        body += "\n\nexport default D;";

        await writer.writeCodeFile({
            fileInnerPath: jk_fs.join(this.getGenOutputDir(item), key.substring(key.indexOf("!") + 1)),
            srcFileContent: allImports.ts + "\n" + body,
            distFileContent: allImports.js + "\n" + body
        });
    }
}