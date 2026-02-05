import {TypeInDirChunk, type TypeInDirChunk_Item} from "./coreAliasTypes.ts";
import * as jk_fs from "jopi-toolkit/jk_fs";
import {CodeGenWriter, FilePart, InstallFileType} from "./linkerEngine.ts";

interface TypeServerActions_Item extends TypeInDirChunk_Item {
}

export default class TypeServerActions extends TypeInDirChunk {
    async beginGeneratingCode(writer: CodeGenWriter) {
    }

    async generateCodeForItem(writer: CodeGenWriter, key: string, dsItem: TypeServerActions_Item): Promise<void> {
    }
}