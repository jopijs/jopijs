import {type TypeList_Group, TypeList} from "./coreAliasTypes.ts";
import {CodeGenWriter, FilePart, InstallFileType, type RegistryItem} from "./engine.ts";

/**
 * Allows the linker to generate an event entry.
 * Will allow to do `import myEvent from "@/events/myEventName`
 */
export function addStaticEvent(eventName: string) {
    if (!gExtraStaticEvents.includes(eventName)) {
        gExtraStaticEvents.push(eventName);
    }
}

const gExtraStaticEvents: string[] = [];

export default class TypeEvents extends TypeList {
    protected getShadowLists(): string[]|undefined {
        // Will allow generating the code for some events
        // that can be called through jk_events.sendEvent(eventName)
        // but where we don't have added static listeners for this event.
        //
        // Doing this mainly allows adding React.js listeners to this event
        // and knowing that this event exists (for very util one).
        //
        return gExtraStaticEvents;
    }

    async endGeneratingCode(writer: CodeGenWriter, items: RegistryItem[]): Promise<void> {
        let count = 0;

        // Here items are individual event listeners.
        // There are not sorted, an item can be bound to an event A and another item to another event.
        //
        for (let item of items) {
            count++;

            let list = item as TypeList_Group;

            // Note: inside installServer.js: use the global event handler.
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

    protected codeGen_generateExports(eventListeners: string, eventName: string) {
        return `export const list = ${eventListeners};
const event = createStaticEvent(${JSON.stringify(eventName)}, list);
export default useStaticEvent(event);`;
    }

    protected codeGen_createDeclarationTypes() {
        return `import type { SyncEventListener, StaticEvent } from "jopi-toolkit/jk_events";
export declare const list: SyncEventListener[];
export declare const event: StaticEvent;
export default event;`
    }
}