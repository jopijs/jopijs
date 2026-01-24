import type { IActionContext, JopiDataTable, JDataTable, JActionResult, JDataReadParams, JDataReadResult } from "jopi-toolkit/jk_data";
import type { Schema } from "jopi-toolkit/jk_schema";
import type { JopiRequest, JopiTableServerActions } from "jopijs";

export function toDataTable(ds: JopiDataTable, name: string, serverActions?: JopiTableServerActions): JDataTable {
    return new DataTableWrapper(ds, name, serverActions);
}

class DataTableWrapper implements JDataTable  {
    public readonly schema: Schema;
    
    constructor(private readonly ds: JopiDataTable, public readonly name: string, public readonly serverActions?: JopiTableServerActions) {
        this.schema = ds.schema;
    }

    read(params: JDataReadParams): Promise<JDataReadResult> {
        return this.ds.read(params);
    }

    async executeAction(rows: any[], actionName: string, context?: IActionContext): Promise<JActionResult | void> {
        const req = context as unknown as JopiRequest;
        const action = this.serverActions?.[actionName];

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
}