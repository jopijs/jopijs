import type { JopiRequest } from "./jopiRequest.ts";

export type JTableServerAction = (req: JopiRequest) => Promise<void>;

export type JopiTableServerActions = Record<string, JTableServerAction>;