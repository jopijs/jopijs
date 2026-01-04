import path from "node:path";
import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_fs from "jopi-toolkit/jk_fs";

import fss from "node:fs";
import stripJsonComments from "strip-json-comments";
import {resolve as resolvePath} from "path";

/**
 * Search the entry point of the current package (ex: ./dist/index.json)
 * @param nodePackageDir - The path of the current module.
 * @returns Returns the full path of the script.
 */
export function findNodePackageEntryPoint(nodePackageDir: string): string {
    const packageJsonPath = path.join(nodePackageDir, 'package.json');

    // >>> Try to take the "main" information inside the package.json.

    if (fss.existsSync(packageJsonPath)) {
        try {
            const packageJson = JSON.parse(fss.readFileSync(packageJsonPath, 'utf8'));

            if (packageJson.main) {
                const mainPath = path.join(nodePackageDir, packageJson.main);
                if (fss.existsSync(mainPath)) return mainPath;
            }
        } catch {
            // Ignore JSON parse errors
        }
    }

    // >>> "main" not set? Try all common path.

    const commonPaths = [
        path.join('dist', 'index.js'),
        path.join('lib', 'index.js'),
        path.join('src', 'index.js'),
        'index.js'
    ];

    for (const commonPath of commonPaths) {
        const fullPath = path.join(nodePackageDir, commonPath);
        if (fss.existsSync(fullPath)) return fullPath;
    }

    // Default to dist/index.js
    return path.join(nodePackageDir, 'dist', 'index.js');
}

let gCache_getPathAliasInfo: PathAliasInfo|undefined;

export interface PathAliasInfo {
    rootDir: string;
    alias: Record<string, string>
}

/**
 * Return a dictionary of path alias (ex: import "@/ui/myComponent")
 */
export async function getPathAliasInfo(): Promise<PathAliasInfo> {
    if (gCache_getPathAliasInfo) return gCache_getPathAliasInfo;

    let pkgJsonFile = jk_app.findRequiredPackageJson();
    if (!pkgJsonFile) throw new Error("Package.json not found");

    const rootDir = path.dirname(pkgJsonFile);

    let tsconfigJsonPath = path.join(rootDir, "tsconfig.json");

    if (!await jk_fs.isFile(tsconfigJsonPath)) {
        throw new Error(`tsconfig.json not found at ${tsconfigJsonPath}`);
    }

    let asText = await jk_fs.readTextFromFile(tsconfigJsonPath);
    asText = stripJsonComments(asText)
    let asJson: any;

    try { asJson = JSON.parse(asText); }
    catch (e: any) { throw `Loader - Can't parse tsconfig.json at ${tsconfigJsonPath}\n|- ${e.message}`; }

    let compilerOptions = asJson.compilerOptions;
    let declaredAliases: Record<string, string> = {};

    if (compilerOptions) {
        let paths = compilerOptions.paths;

        /** Exemple
         * "paths": {
         *       "@/*": ["./src/shadcn/*"],
         *       "@/lib/*": ["./src/shadcn/lib/*"],
         *       "@/components/*": ["./src/shadcn/components/*"]
         *     }
         */

        for (let alias in paths) {
            let pathAlias = paths[alias].pop() as string;
            if (!pathAlias) continue;

            let isWildcard = pathAlias.endsWith("*");
            if (alias.endsWith("*")) alias = alias.substring(0, alias.length - 1);
            if (pathAlias.endsWith("*")) pathAlias = pathAlias.substring(0, pathAlias.length - 1);

            if (!path.isAbsolute(pathAlias)) {
                pathAlias = resolvePath(rootDir, pathAlias);
            }

            if (!alias.endsWith("/")) alias += "/";
            if (isWildcard && !pathAlias.endsWith("/")) pathAlias += "/";

            declaredAliases[alias] = pathAlias;
        }
    }

    return gCache_getPathAliasInfo = {rootDir, alias: declaredAliases};
}