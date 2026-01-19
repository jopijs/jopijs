import path from "node:path";
import * as jk_fs from "jopi-toolkit/jk_fs";
import type {JopiRequest} from "../jopiRequest.ts";
import fs from "node:fs/promises";
import {makeIterable} from "../internalTools.ts";
import type {CacheEntry, CacheMeta, PageCache} from "./cache.ts";
import {SBPE_NotAuthorizedException} from "../jopiCoreWebSite.ts";

export class WebSiteMirrorCache implements PageCache {
    public readonly rootDir: string;
    public readonly rootDirAtFileUrl: string;

    constructor(rootDir: string) {
        if (!rootDir) rootDir = ".";
        if (!path.isAbsolute(rootDir)) rootDir = path.resolve(process.cwd(), rootDir);
        else rootDir = jk_fs.resolve(rootDir);

        this.rootDir = rootDir;
        this.rootDirAtFileUrl = jk_fs.pathToFileURL(this.rootDir).href;
    }

    private calKey(url: URL): string {
        let pathName = url.pathname;
        if (pathName.includes("..")) throw new SBPE_NotAuthorizedException();

        const sURL = this.rootDirAtFileUrl + pathName;
        let result = jk_fs.resolve(jk_fs.fileURLToPath(sURL));

        if (!result.startsWith(this.rootDir)) {
            throw new SBPE_NotAuthorizedException();
        }

        return result;
    }

    private calcFilePath(url: URL): string {
        let fp = this.calKey(url);

        if (fp.endsWith("/")) {
            fp += "index.html";
        } else {
            const ext = path.extname(fp);
            if (!ext) fp += "/index.html";
        }

        return fp;
    }

    async addToCache(req: JopiRequest, url: URL, response: Response): Promise<Response> {
        // We don't store 404 and others.
        if (response.status !== 200) return response;

        const filePath = this.calcFilePath(url);
        await fs.mkdir(path.dirname(filePath), {recursive: true});

        try {
            if (!response.body) return response;
            await jk_fs.writeResponseToFile(new Response(response.body), filePath);
            return await req.file_returnFile(filePath);
        } catch (e) {
            console.error(e);
            return new Response("", {status: 500});
        }
    }

    async removeFromCache(url: URL): Promise<void> {
        const filePath = this.calcFilePath(url);
        await fs.unlink(filePath);
    }

    async hasInCache(url: URL): Promise<boolean> {
        const filePath = this.calcFilePath(url);
        const stats = await jk_fs.getFileStat(filePath);
        return !!stats && stats.isFile();
    }

    getFromCache(req: JopiRequest, url: URL): Promise<Response | undefined> {
        const filePath = this.calcFilePath(url);
        return req.file_tryReturnFile(filePath);
    }

    async getFromCacheWithMeta(req: JopiRequest, url: URL): Promise<{ response: Response; meta?: CacheMeta } | undefined> {
        const filePath = this.calcFilePath(url);
        const res = await req.file_tryReturnFile(filePath);
        if (!res) return undefined;
        return {response: res, meta: undefined};
    }

    getCacheMeta(_url: URL): Promise<CacheMeta | undefined> {
        return Promise.resolve(undefined);
    }

    createSubCache(name: string): PageCache {
        const newDir = path.join(this.rootDir, "_ subCaches", name);
        return new WebSiteMirrorCache(newDir);
    }

    getCacheEntryIterator() {
        return makeIterable({
            next(): IteratorResult<CacheEntry> {
                return {value: undefined, done: true};
            }
        });
    }

    getSubCacheIterator() {
        return makeIterable({
            next(): IteratorResult<string> {
                return {value: undefined, done: true};
            }
        });
    }
}