import type { JActionResult } from "jopi-toolkit/jk_data";
import type { JopiRequest } from "./jopiRequest.ts";

export type JTableServerAction = (req: JopiRequest, rows?: any[]) => Promise<JActionResult|void>;

export type JopiTableServerActions = Record<string, JTableServerAction>;