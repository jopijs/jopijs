import type { IActionContext, JopiDataTable, JDataTable, JActionResult } from "jopi-toolkit/jk_data";
import type { JopiRequest, JopiTableServerActions } from "jopijs";

export function toDataTable(ds: JopiDataTable, name: string, serverActions?: JopiTableServerActions): JDataTable {
    return {
        ...ds, name,

        executeAction: async (rows: any[], actionName: string, context?: IActionContext): Promise<JActionResult | void> => {
            const req = context as unknown as JopiRequest;
            const action = serverActions?.[actionName];

            if (!action) {
                return {
                    isOk: false,
                    errorCode: "ACTION_NOT_FOUND",
                    errorMessage: `Action "${actionName}" not found`
                };
            }

            let res = await action(req, rows);
            if (res) return res;
        }
    };
}