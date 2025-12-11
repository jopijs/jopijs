import {type TypeList_Group, TypeList} from "./coreAliasTypes.ts";
import {CodeGenWriter, FilePart, InstallFileType, type RegistryItem} from "./engine.ts";

export default class TypeEvents extends TypeList {
    async endGeneratingCode(writer: CodeGenWriter, items: RegistryItem[]): Promise<void> {
        let count = 0;

        // Here items are individual event listeners.
        // There are not sorted, an item can be bound to an event A and another item to another event.
        //
        for (let item of items) {
            count++;

            let list = item as TypeList_Group;

            // Note: inside installServer.js : use the global event handler.
            //       inside installBrowser.js: use the event handler local to the request.
            //
            let jsSources = `    registry.events.addProvider("${list.listName}", async () => { const R = await import("@/events/${list.listName}"); return R.list; });`;
            writer.genAddToInstallFile(InstallFileType.both, FilePart.body, jsSources);
        }
    }

    protected codeGen_generateImports() {
        return `import {createStaticEvent} from "jopi-toolkit/jk_events"
import {useStaticEvent} from "jopijs/ui";        
`;
    }

    protected codeGen_generateExports(array: string, eventName: string) {
        return `export const list = ${array};
const event = createStaticEvent(${JSON.stringify(eventName)}, list);
export default useStaticEvent(event);`;
    }

    protected codeGen_createDeclarationTypes() {
        return `import type { SyncEventListener, StaticEvent } from "jopi-toolkit/jk_events";
export declare const list: SyncEventListener[];
export declare const event: StaticEvent;
export default event;`
    }

    protected normalizeConditionName(condName: string): string|undefined {
        if (condName.startsWith("if")) {
            condName = condName.substring(2);
        }

        condName = condName.replace("-", "");
        condName = condName.replace("_", "");

        if (condName==="browser") {
            return  "if_browser";
        }
        else if (condName==="server") {
            return "if_server";
        }

        return undefined;
    }
}