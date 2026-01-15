import fetch from "node-fetch";
import https from "node:https";
import type { CrawlerFetchResponse } from "./common.ts";

export async function nodeFetch(url: string, options: { 
    headers?: Record<string, string>,
    rejectUnauthorized?: boolean
} = {}): Promise<CrawlerFetchResponse> {
    const agent = new https.Agent({
        rejectUnauthorized: options.rejectUnauthorized !== false,
    });

    const response = await fetch(url, {
        method: "GET",
        headers: options.headers,
        agent: url.startsWith("https") ? agent : undefined
    });

    return {
        status: response.status,
        headers: response.headers as any,
        body: response.body as any,
        async text() {
            return response.text();
        },
        async arrayBuffer() {
            return response.arrayBuffer();
        }
    };
}

