import {TypeInDirChunk} from "./coreAliasTypes.ts";
import {collector_declareUiComponent} from "./dataCollector.ts";
import {innerPathToAbsolutePath_src} from "./engine.ts";

export class TypeUI extends TypeInDirChunk {
    protected onSourceFileAdded(fileInnerPath: string) {
        collector_declareUiComponent(innerPathToAbsolutePath_src(fileInnerPath) + ".ts");
    }
}