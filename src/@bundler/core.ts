import * as jk_events from "jopi-toolkit/jk_events";
import type {CreateBundleParams} from "jopijs/core";
import {getWebSiteConfig} from "jopijs/coreconfig";
import {esBuildBundle} from "./esbuild.ts";

async function createBundle(params: CreateBundleParams): Promise<void> {
    const config = params.config;

    process.env.JOPI_BUNLDER_ESBUILD = "1";

    try {
        await esBuildBundle({
            dontEmbed: config.embed.dontEmbedThis,
            ...params
        });
    }
    finally {
        delete process.env.JOPI_BUNLDER_ESBUILD;
    }
}

jk_events.addListener("@jopi.bundler.createBundle", jk_events.EventPriority.veryLow, async (params: CreateBundleParams) => {
    // For React HMR, creating the full bundle is not required
    // and will only slow down the startup.
    //
    if (getWebSiteConfig().hasReactHmrFlag) return;

    // Will compile all the pages.
    await createBundle(params);
});

jk_events.addListener("@jopi.bundler.createBundleForPage", jk_events.EventPriority.veryLow, async (params: CreateBundleParams) => {
    // Will compile only the selected page, because of params values.
    await createBundle(params);
});