
import path from "node:path";
import fs from "node:fs/promises";
import fss from "node:fs";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_crypto from "jopi-toolkit/jk_crypto";
import { makeIterable } from "../internalTools.js";
import type { ObjectCache, ObjectCacheEntry, ObjectCacheMeta } from "./interfaces.ts";

export class FileStore implements ObjectCache {
    private readonly subCaches: Record<string, FileStore> = {};
    public readonly rootDir: string;

    constructor(rootDir: string) {
        if (!rootDir) rootDir = ".";
        if (!path.isAbsolute(rootDir)) rootDir = path.resolve(process.cwd(), rootDir);
        this.rootDir = rootDir;
    }

    createSubCache(name: string): ObjectCache {
        let cache = this.subCaches[name];
        if (!cache) {
            const newDir = path.join(this.rootDir, "_subCaches", name);
            cache = new FileStore(newDir);
            this.subCaches[name] = cache;
        }
        return cache;
    }

    private calKey(key: string): string {
        return jk_crypto.fastHash(key);
    }

    private calcFilePath(key: string): string {
        const hash = this.calKey(key);
        // Use 2 levels of nesting to avoid too many files in one dir
        return path.join(this.rootDir, hash.substring(0, 2), hash + ".json");
    }

    async set<T>(key: string, value: T, meta?: ObjectCacheMeta | undefined): Promise<void> {
        if (!meta) meta = {};

        const entry: ObjectCacheEntry<T> = { key, value, meta };
        const content = JSON.stringify(entry);
        const filePath = this.calcFilePath(key);

        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await jk_fs.writeTextToFile(filePath, content);
    }

    async get<T>(key: string): Promise<T | undefined> {
        const entry = await this.readEntry<T>(key);
        return entry ? entry.value : undefined;
    }

    async getWithMeta<T>(key: string): Promise<{ value: T; meta: ObjectCacheMeta } | undefined> {
        const entry = await this.readEntry<T>(key);
        return entry ? { value: entry.value, meta: entry.meta } : undefined;
    }

    async has(key: string): Promise<boolean> {
        const filePath = this.calcFilePath(key);
        const stats = await jk_fs.getFileStat(filePath);
        return !!stats;
    }

    async delete(key: string): Promise<void> {
        const filePath = this.calcFilePath(key);
        await jk_fs.unlink(filePath);

        for (let subCache of Object.values(this.subCaches)) {
            await subCache.delete(key);
        }
    }

    getSubCacheIterator(): Iterable<string> {
        const subCacheDir = path.join(this.rootDir, "_subCaches");
        if (!fss.existsSync(subCacheDir)) {
            return makeIterable<string>({ next: () => ({ value: undefined, done: true }) });
        }

        const items = fss.readdirSync(subCacheDir);
        let index = 0;

        return makeIterable({
            next(): IteratorResult<string> {
                while (index < items.length) {
                    const item = items[index++];
                    const itemPath = path.join(subCacheDir, item);
                    try {
                        if (fss.statSync(itemPath).isDirectory()) {
                            return { value: item, done: false };
                        }
                    } catch {
                        // ignore
                    }
                }
                return { value: undefined, done: true };
            }
        });
    }

    keys(): Iterable<string> {
        const rootDir = this.rootDir;
        const nextFileProvider = iterateFiles(this.rootDir);

        return makeIterable({
            next(): IteratorResult<string> {
                while (true) {
                    let nextFile = nextFileProvider.next();
                    if (nextFile.done) return { done: true, value: undefined };

                    const relativePath = nextFile.value;
                    const fullPath = path.join(rootDir, relativePath);
                    
                    try {
                        // We must read the file to get the real key
                         const content = fss.readFileSync(fullPath, 'utf-8');
                         const entry = JSON.parse(content) as ObjectCacheEntry;
                         return { value: entry.key, done: false };
                    } catch {
                        // Ignore unreadable/corrupt files and continue
                        continue;
                    }
                }
            }
        });
    }

    private async readEntry<T>(key: string): Promise<ObjectCacheEntry<T> | undefined> {
        const filePath = this.calcFilePath(key);
        try {
            const content = await jk_fs.readTextFromFile(filePath);
            return JSON.parse(content);
        } catch {
            return undefined;
        }
    }
}

function* iterateFiles(baseRoot: string, currentDir: string = baseRoot): Generator<string> {
    if (!fss.existsSync(currentDir)) return;

    const items = fss.readdirSync(currentDir);

    for (const item of items) {
        if (item === "_subCaches") continue;

        const itemPath = path.join(currentDir, item);
        
        try {
            const stats = fss.statSync(itemPath);

            if (stats.isDirectory()) {
                yield* iterateFiles(baseRoot, itemPath);
            } else if (stats.isFile() && item.endsWith('.json')) {
                yield path.relative(baseRoot, itemPath);
            }
        } catch {
            // Access denied or deleted
        }
    }
}
