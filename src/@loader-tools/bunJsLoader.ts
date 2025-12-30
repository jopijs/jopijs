import {bunLoaderPlugin} from "./bunLoaderPlugin.ts";

// https://bun.com/docs/runtime/plugins

export function installBunJsLoader() {
    Bun.plugin(bunLoaderPlugin);
}