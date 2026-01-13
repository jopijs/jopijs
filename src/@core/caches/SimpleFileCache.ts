import {gzipFile} from "../gzip.ts";
import path from "node:path";
import fs from "node:fs/promises";
import fss from "node:fs";
import type {CacheEntry, PageCache} from "./cache.ts";
import {
    cacheAddBrowserCacheValues,
    cacheEntryToResponse,
    makeIterable,
    responseToCacheEntry
} from "../internalTools.ts";

import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_crypto from "jopi-toolkit/jk_crypto";
import type {JopiRequest} from "../jopiRequest.tsx";
import {ONE_MEGA_OCTET} from "../publicTools.ts";

export class SimpleFileCache implements PageCache {
    private readonly subCaches: Record<string, SimpleFileCache> = {};
    public readonly rootDir: string;
    
    constructor(rootDir: string) {
        if (!rootDir) rootDir = ".";
        if (!path.isAbsolute(rootDir)) rootDir = path.resolve(process.cwd(), rootDir);
        this.rootDir = rootDir;
    }

    private calKey(url: URL): string {
        // Using a hash allows avoiding difficulties with query string special characters.
        return jk_crypto.fastHash(url.toString());
    }

    private calcFilePath(url: URL): string {
        const key = this.calKey(url);
        let fp = path.join(this.rootDir, key[0], key);
        if (fp.endsWith("/")) fp += "index.html";
        return fp;
    }

    private gzipMaxSize = 20 * ONE_MEGA_OCTET;

    async addToCache(req: JopiRequest, url: URL, response: Response, headersToInclude: string[]|undefined): Promise<Response> {
        if ((response.status!==200) || (!response.body)) {
            return response;
        }

        let filePath = this.calcFilePath(url);
        await jk_fs.writeResponseToFile(response, filePath);

        let fileState = (await jk_fs.getFileStat(filePath))!;
        const byteLength = fileState.size;
        const canCompress = byteLength < this.gzipMaxSize;

        await this.saveNewCacheEntry(url, response, headersToInclude, canCompress, filePath);

        if (canCompress) {
            // Compress the file and remove the uncompressed one.
            await gzipFile(filePath, filePath + " gz");
            await jk_fs.unlink(filePath);

            return await req.file_returnFile(filePath + " gz", {contentEncoding: "gzip"});
        } else {
            return await req.file_returnFile(filePath);
        }
    }

    async removeFromCache(url: URL): Promise<void> {
        const filePath = this.calcFilePath(url);

        await jk_fs.unlink(filePath);
        await jk_fs.unlink(filePath + " gz");
        await jk_fs.unlink(filePath + " info");

        for (let subCache of Object.values(this.subCaches)) {
            await subCache.removeFromCache(url);
        }
    }

    async getFromCache(req: JopiRequest, url: URL): Promise<Response|undefined> {
        const cacheEntry = await this.getCacheEntry(url);

        // Mean the entry doesn't exist.
        if (!cacheEntry) {
            return undefined;
        }

        if (cacheEntry.status===200) {
            let toReturn = req.file_validateCacheHeadersWith(cacheEntry.headers);
            if (toReturn) return toReturn;

            let filePath = this.calcFilePath(url);
            if (cacheEntry.isGzipped) filePath += " gz";

            const fileBytes = await jk_fs.readFileToBytes(filePath);
            cacheEntry.binary = new Uint8Array(fileBytes.buffer as ArrayBuffer);
            cacheEntry.binarySize = fileBytes.length;
        }

        return cacheEntryToResponse(cacheEntry);
    }

    async hasInCache(url: URL, requireUncompressedVersion?: boolean|undefined): Promise<boolean> {
        const cacheEntry = await this.getCacheEntry(url);
        if (!cacheEntry) return false;

        if (requireUncompressedVersion===undefined) return true;
        if (requireUncompressedVersion) return cacheEntry.isGzipped===false;
        return cacheEntry.isGzipped===true;
    }

    private async getCacheEntry(url: URL): Promise<CacheEntry|undefined> {
        const filePath = this.calcFilePath(url);

        try {
            return JSON.parse(await jk_fs.readTextFromFile(filePath + " info", true));
        }
        catch {
            // We are here if the file doesn't exist.
            return undefined;
        }
    }

    private async saveNewCacheEntry(url: URL, response: Response, headersToInclude: string[]|undefined, isGzipped: boolean, filePath: string) {
        const cacheEntry = responseToCacheEntry(url.href, response, headersToInclude);
        cacheEntry.isGzipped = isGzipped;

        const etag = (await jk_fs.calcFileHash(filePath))!;
        cacheAddBrowserCacheValues(cacheEntry, etag);

        filePath += " info";
        await fs.mkdir(path.dirname(filePath), {recursive: true});
        await jk_fs.writeTextToFile(filePath, JSON.stringify(cacheEntry));
    }

    createSubCache(name: string): PageCache {
        let cache = this.subCaches[name];

        if (!cache) {
            const newDir = path.join(this.rootDir, "_ subCaches", name);
            cache = new SimpleFileCache(newDir);
            this.subCaches[name] = cache;
        }

        return cache;
    }

    getCacheEntryIterator() {
        function getCacheEntryFrom(filePath: string): CacheEntry|undefined {
            return jk_fs.readJsonFromFileSync<CacheEntry>(filePath);
        }

        const rootDir = this.rootDir;
        const nextFileProvider = iterateFiles(this.rootDir);

        return makeIterable({
            next(): IteratorResult<CacheEntry> {
                while (true) {
                    let nextFile = nextFileProvider.next();
                    if (nextFile.done) return {done: true, value: undefined};

                    const cacheEntry = getCacheEntryFrom(path.join(rootDir, nextFile.value));
                    if (cacheEntry) return {done: false, value: cacheEntry};
                }
            }
        });
    }

    getSubCacheIterator() {
        const alreadyReturned: string[] = [];
        const iterator = iterateFiles(this.rootDir);

        return makeIterable({
            next(): IteratorResult<string> {
                while (true) {
                    const result = iterator.next();
                    if (!result.done) return {value: undefined, done: true};

                    const filePath = result.value[0];

                    if (filePath.startsWith("_ subCaches")) {
                        const parts = filePath.split(path.sep);
                        const subCacheName = parts[1];

                        if (!alreadyReturned.includes(subCacheName)) {
                            alreadyReturned.push(subCacheName);
                            return {value: subCacheName, done: false};
                        }
                    }
                }
            }
        });
    }
}

function* iterateFiles(rootDir: string): Generator<string> {
    const items = fss.readdirSync(rootDir);

    for (const item of items) {
        const itemPath = path.join(rootDir, item);
        const stats = fss.statSync(itemPath);

        if (stats.isDirectory()) {
            yield* iterateFiles(itemPath);
        } else if (stats.isFile() && item.endsWith(' info')) {
            const relativePath = path.relative(rootDir, itemPath);
            yield relativePath;
        }
    }
}