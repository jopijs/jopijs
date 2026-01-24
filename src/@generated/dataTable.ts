import type { JDataBinding, JDataTable } from "jopi-toolkit/jk_data";

export function toDataTable(ds: JDataBinding, name: string): JDataTable {
    return { ...ds, name };
}