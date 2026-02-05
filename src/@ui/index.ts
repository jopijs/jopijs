import { isBrowser } from "jopi-toolkit/jk_what";

export * from "./user.ts";
export * from "./pageController.ts";
export * from "./cssModules.ts";
export * from "./interfaces.ts";

export * from "./hooks/index.ts";
export * from "./modules.ts";
export * from "./valueStore.ts";
export * from "./cookies/index.ts";
export * from "./htmlNode.ts";
export * from "./events.ts";
export * from "./utils.ts";
export * from "./serverAction.ts";

export const isBrowserSide = isBrowser;
export const isServerSide = !isBrowser;