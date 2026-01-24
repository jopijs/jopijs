import type { IActionContext, JopiDataTable, JDataTable } from "jopi-toolkit/jk_data";
import type { JopiTableServerActions } from "jopijs";

export function toDataTable(ds: JopiDataTable, name: string, serverActions?: JopiTableServerActions): JDataTable {
    return {
        ...ds, name,

        executeAction: async (rows: any[], actionName: string, context: IActionContext) => {
            debugger;
            // TODO
        }  
    };
}