import { TypeInDirChunk, type TypeInDirChunk_Item } from "./coreAliasTypes.ts";
import type { CodeGenWriter } from "./engine.ts";
import * as jk_fs from "jopi-toolkit/jk_fs";

export class TypeDataProvider extends TypeInDirChunk {
    async generateCodeForItem(writer: CodeGenWriter, key: string, item: TypeInDirChunk_Item) {
        let entryPoint = item.entryPoint;
        key = key.substring("dataProviders!".length);

        const outDir = jk_fs.join(writer.dir.output_src, "dataProvider");
        const relPath = jk_fs.getRelativePath(outDir, entryPoint);

        const importPathTs = writer.toPathForImport(relPath, false);
        const importPathJs = writer.toPathForImport(relPath, true);

        const srcContent = `import {DataProvider} from "jopijs/generated";
import providerDef from "${importPathTs}";

const provider = new DataProvider("${key}", providerDef);
export default provider;
`;

        const distContent = `
import {DataProvider} from "jopijs/generated";
import providerDef from "${importPathJs}";

const provider = new DataProvider("${key}", providerDef);
export default provider;
`;

        await writer.writeCodeFile({
            fileInnerPath: `dataProviders/${key}`,
            srcFileContent: srcContent,
            distFileContent: distContent
        });
    }
}