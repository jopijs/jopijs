import {TypeChunk, type TypeChunk_Item} from "./coreAliasTypes.ts";
import * as jk_fs from "jopi-toolkit/jk_fs";
import {normalizeNeedRoleConditionName} from "./common.ts";
import {CodeGenWriter, type RegistryItem} from "./engine.ts";

interface TypeDataSource_Item extends TypeChunk_Item {
    mustExpose: boolean;
}

export default class TypeDataSource extends TypeChunk {
    protected normalizeConditionName(condName: string, filePath: string, ctx: any|undefined): string|undefined {
        return normalizeNeedRoleConditionName(condName, filePath, ctx, ["READ", "WRITE"]);
    }

    async onChunk(chunk: TypeChunk_Item, key: string, _dirPath: string) {
        let dsItem: TypeDataSource_Item = chunk as TypeDataSource_Item;

        // Must expose this data source to the network?
        dsItem.mustExpose = await jk_fs.isFile(jk_fs.join(chunk.itemPath, "expose.enable"));

        this.registry_addItem(key, chunk);
    }

    generateCodeForItem(writer: CodeGenWriter, key: string, rItem: RegistryItem): Promise<void> {
        return Promise.resolve();
    }
}