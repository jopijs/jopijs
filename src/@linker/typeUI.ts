import {TypeInDirChunk, type TypeInDirChunk_Item} from "./coreAliasTypes.ts";
import {collector_declareUiComponent} from "./dataCollector.ts";
import {CodeGenWriter, innerPathToAbsolutePath_src} from "./linkerEngine.ts";
import * as jk_fs from "jopi-toolkit/jk_fs";

interface TypeUi_Item extends TypeInDirChunk_Item {
    hasStyle?: boolean;
}

export class TypeUI extends TypeInDirChunk {
    protected onSourceFileAdded(fileInnerPath: string) {
        collector_declareUiComponent(innerPathToAbsolutePath_src(fileInnerPath) + ".ts");
    }

    async onChunk(chunk: TypeUi_Item, key: string, dirPath: string) {
        if (await jk_fs.isFile(jk_fs.join(dirPath, "style.module.css"))) {
            chunk.hasStyle = true;

            // Allows the file to always exist.
            let fileContent = `import styles from "./style.module.css";\nexport default styles;`;
            await jk_fs.writeTextToFile(jk_fs.join(dirPath, "style.gen.ts"), fileContent);
        }

        return super.onChunk(chunk, key, dirPath);
    }

    async generateCodeForItem(writer: CodeGenWriter, key: string, item: TypeUi_Item) {
        await super.generateCodeForItem(writer, key, item);

        if (item.hasStyle) {
            const dirPath = item.itemPath;
            let cssFilePath = "./style.module.css";

            key = "styles!" + key.substring(3);
            let styleOverride = this.registry_getItem<TypeInDirChunk_Item>(key);

            if (styleOverride) {
                cssFilePath = jk_fs.getRelativePath(dirPath, styleOverride.entryPoint);
            }

            let fileContent = `import styles from ${JSON.stringify(cssFilePath)};\nexport default styles;`;
            await jk_fs.writeTextToFile(jk_fs.join(dirPath, "style.gen.ts"), fileContent);
        }
    }
}