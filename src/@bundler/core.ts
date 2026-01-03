import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_events from "jopi-toolkit/jk_events";
import type {CreateBundleParams} from "jopijs";
import {getWebSiteConfig} from "jopijs/coreconfig";
import {esBuildBundle} from "./esbuild.ts";

async function createBundle(params: CreateBundleParams): Promise<void> {
    const config = params.config;

    // Load the metadata generated.
    const metaDataFilePath = jk_fs.join(params.genDir, "esbuildInvolvedFiles.json");

    process.env.JOPI_BUNLDER_ESBUILD = "1";

    try {
        await esBuildBundle({
            metaDataFilePath,
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
    if (getWebSiteConfig().isReactHMR) return;

    // Will compile all the pages.
    await createBundle(params);
});

jk_events.addListener("@jopi.bundler.createBundleForPage", jk_events.EventPriority.veryLow, async (params: CreateBundleParams) => {
    // Will compile only the selected page, because of params values.
    await createBundle(params);
});