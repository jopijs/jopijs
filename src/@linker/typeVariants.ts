import {type TypeInDirChunk_Item, TypeInDirChunk} from "./coreAliasTypes.ts";
import * as jk_fs from "jopi-toolkit/jk_fs";

export class TypeVariants extends TypeInDirChunk {
    async processDir(p: { moduleDir: string; typeDir: string; genDir: string; }) {
        let dirItems = await jk_fs.listDir(p.typeDir);

        for (let dirItem of dirItems) {
            if (!dirItem.isDirectory) continue;
            if (dirItem.name[0] === "_") continue;
            if (dirItem.name[0] === ".") continue;

            let itemSubType = dirItem.name;
            let itemType = this.typeName + ':' + dirItem.name;

            await this.dir_recurseOnDir({
                dirToScan: dirItem.fullPath,
                expectFsType: "dir",

                rules: {
                    rootDirName: jk_fs.basename(p.typeDir),
                    nameConstraint: "canBeUid",
                    requireRefFile: false,
                    requirePriority: true,

                    filesToResolve: {
                        "entryPoint": ["index.tsx", "index.ts"]
                    },

                    transform: async (props) => {
                        if (!props.resolved?.entryPoint) {
                            throw this.declareError("No 'index.ts' or 'index.tsx' file found", props.itemPath);
                        }

                        const chunk: TypeInDirChunk_Item = {
                            type: this,

                            entryPoint: props.resolved?.entryPoint,

                            conditions: props.conditions,
                            conditionsContext: props.conditionsContext,
                            features: props.features,

                            itemType: itemSubType,

                            itemPath: props.itemPath,
                            priority: props.priority
                        };

                        const key = itemType + "!" + props.itemName;
                        await this.onChunk(chunk, key, props.itemPath);
                    }
                }
            });
        }
    }

    protected getGenOutputDir(chunk: TypeInDirChunk_Item) {
        return jk_fs.join(this.typeName, chunk.itemType);
    }
}