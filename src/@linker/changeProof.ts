import * as fs from 'fs/promises';
import * as fss from 'fs';
import * as path from 'path';
import * as jk_crypto from "jopi-toolkit/jk_crypto";
import * as jk_fs from "jopi-toolkit/jk_fs";

/**
 * Recursive internal function to collect file/folder information strings.
 * All paths in the resulting strings are relative to 'basePath'.
 */
export async function calculateDirectoryProof(rootDir: string): Promise<string> {
    async function collectProofString(currentPath: string): Promise<string> {
        let dirItems: fss.Dirent[];

        try {
            dirItems = await fs.readdir(currentPath, {withFileTypes: true});
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'EACCES') return "";
            throw error;
        }

        dirItems.sort((a, b) => a.name.localeCompare(b.name));

        let chunksString = "";

        for (const dirItem of dirItems) {
            const fullPath = path.join(currentPath, dirItem.name);
            const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
            const stats = await fs.lstat(fullPath);

            if (stats.isSymbolicLink()) {
                let target = await fs.readlink(fullPath);
                target = path.relative(rootDir, fullPath).replace(/\\/g, '/');
                chunksString += `SYM_LINK:${relativePath}:${target}`;
            } else if (dirItem.isDirectory()) {
                chunksString += await collectProofString(fullPath);
            } else if (dirItem.isFile()) {
                try {
                    let md5 = jk_crypto.md5(await jk_fs.readTextFromFile(fullPath, true));
                    chunksString += `FILE:${relativePath}:${md5}`;
                }
                catch (e) {
                    chunksString += `FILE:${relativePath}:???`;
                }
            }
        }

        return chunksString;
    }

    const chunksString = await collectProofString(rootDir);
    return jk_crypto.md5(chunksString);
}