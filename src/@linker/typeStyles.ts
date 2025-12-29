import {TypeInDirChunk, type TypeInDirChunk_Item} from "./coreAliasTypes.ts";
import {type ScanDirItemsParams} from "./engine.ts";

export class TypeStyles extends TypeInDirChunk {
    async onChunk(chunk: TypeInDirChunk_Item, key: string, dirPath: string) {
        return super.onChunk(chunk, key, dirPath);
    }

    protected hookProcessDirRules(rules: ScanDirItemsParams) {
        rules.rules!.filesToResolve = {"entryPoint": ["style.module.css", "style.module.scss"]};
        return rules;
    }
}