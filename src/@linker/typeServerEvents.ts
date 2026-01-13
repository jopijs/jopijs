import {type TypeList_Group} from "./coreAliasTypes.ts";
import { CodeGenWriter, FilePart, InstallFileType, type RegistryItem } from "./engine.ts";
import TypeEvents from "./typeEvents.ts";

/**
 * Allows the linker to generate an event entry.
 * Will allow to do `import myEvent from "@/events/myEventName`
 */
export function addStaticEvent_server(eventName: string) {
    if (!gExtraStaticEvents_server.includes(eventName)) {
        gExtraStaticEvents_server.push(eventName);
    }
}

const gExtraStaticEvents_server: string[] = [];

export default class TypeServerEvents extends TypeEvents {
    protected getShadowLists(): string[]|undefined {
        return gExtraStaticEvents_server;
    }

    async endGeneratingCode(writer: CodeGenWriter, items: RegistryItem[]): Promise<void> {
        let count = 0;

        for (let item of items) {
            count++;
            let list = item as TypeList_Group;
            let jsSources = `\n    registry.events.addProvider("${list.listName}", async () => { const R = await import("@/server-events/${list.listName}"); return R.list; });`;
            writer.genAddToInstallFile(InstallFileType.server, FilePart.body, jsSources);
        }
    }
}