import postcss from 'postcss';
import path from "node:path";
import {getWebSiteConfig, jopiTempDir} from "jopijs/coreconfig";

export type PostCssInitializer = (sources: string[], tailwindPlugin:  postcss.AcceptedPlugin|undefined) => postcss.AcceptedPlugin[];

export interface BundlerConfig {
    tailwind: {
        disable?: boolean;
    },

    postCss: {
        initializer?: PostCssInitializer;
    },

    embed: {
        dontEmbedThis?: string[];
    },

    entryPoints: string[];
}

const gBundlerConfig: BundlerConfig = {
    tailwind: {},
    postCss: {},
    embed: {},
    entryPoints: []
}

export function getBundlerConfig(): BundlerConfig {
    return gBundlerConfig;
}

export function getBundleDirPath() {
    const config = getWebSiteConfig();

    let webSiteHost = config.webSiteUrl;
    webSiteHost = config.webSiteUrl.substring(webSiteHost.indexOf("://") + 3);
    webSiteHost = webSiteHost.replaceAll(".", "_").replaceAll(":", "_");

    return path.join(jopiTempDir, webSiteHost);
}