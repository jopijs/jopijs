import {isBrowser} from "jopi-toolkit/jk_what";

export * from "./tools.ts";
export * from "./pageController.ts";
export * from "./cssModules.tsx";
export * from "./interfaces.ts";

export * from "./components.tsx";
export * from "./hooks.tsx";
export * from "./modules.ts";
export * from "./objectRegistry.ts";

export const isBrowserSide = isBrowser;
export const isServerSide = !isBrowser;