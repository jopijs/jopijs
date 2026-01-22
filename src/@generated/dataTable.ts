import type { JNamedTableReader, JTableReader } from "jopi-toolkit/jk_data";

export function toDataTable(ds: JTableReader, name: string): JNamedTableReader {
    return { ...ds, name };
}