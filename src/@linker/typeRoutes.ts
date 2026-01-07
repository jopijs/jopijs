import {
    AliasType,
    CodeGenWriter,
    FilePart,
    getWriter,
    InstallFileType,
    PriorityLevel,
    resolveFile, writeTextToFileIfMismatch
} from "./engine.ts";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_app from "jopi-toolkit/jk_app";
import type { RouteAttributes, RouteBindPageParams, RouteBindVerbParams } from "jopijs/generated";
import { normalizeNeedRoleConditionName } from "./common.ts";
import type { HttpMethod } from "jopijs";
import { isBrowser } from "jopi-toolkit/jk_what";
import { collector_declareUiComponent } from "./dataCollector.ts";

export default class TypeRoutes extends AliasType {
    private sourceCode_header_TS = `import {routeBindPage, routeBindVerb} from "jopijs/generated";`;
    private sourceCode_header_JS = `import {routeBindPage, routeBindVerb} from "jopijs/generated";`;
    private sourceCode_body_TS = "";
    private sourceCode_body_JS = "";

    private cwdDir: string = process.cwd();
    private routeCount: number = 1;

    private registry: Record<string, RegistryItem> = {};
    private routeConfig: Record<string, RouteAttributes> = {};
    private pageData: Record<string, RouteAttributes> = {};

    async beginGeneratingCode(writer: CodeGenWriter): Promise<void> {
        await this.genCode_RouterFile(writer);
        await this.genCode_DeclareServerRoutes(writer);
        this.genCode_DeclarePages();
    }

    private genCode_DeclarePages() {
        for (let item of Object.values(this.registry)) {
            if (item.verb === "PAGE") {
                collector_declareUiComponent(item.filePath);
            }
        }
    }

    private async genCode_DeclareServerRoutes(writer: CodeGenWriter) {
        // region Generate the code calling all the routes.

        // It's lines of type : setPageDataProvider(...);
        //      await routeBindPage(...)
        // or   
        //      await routeBindVerb(...)

        const bindPage = (writer: CodeGenWriter, route: string, filePath: string, attributes: RouteAttributes) => {
            let routeId = "r" + (this.routeCount++);
            let srcFilePath = jk_fs.getRelativePath(this.cwdDir, filePath);

            const routeBindingParams: RouteBindPageParams = {
                route,
                filePath: srcFilePath,
                attributes: {
                    needRoles: attributes.needRoles,
                    disableCache: attributes.disableCache,
                    catchAllSlug: attributes.catchAllSlug,
                }
            };

            // >>> Javascript

            let compiledPath = jk_app.getCompiledFilePathFor(filePath);
            let relPathJS = writer.makePathRelativeToOutput(compiledPath);
            relPathJS = writer.toPathForImport(relPathJS, true);
            this.sourceCode_header_JS += `\nimport c_${routeId} from "${relPathJS}";`;
            this.sourceCode_body_JS += `\n    await routeBindPage(webSite, c_${routeId}, ${JSON.stringify(routeBindingParams)});`;
            
            // >>> Typescript
            
            let relPathTS = writer.makePathRelativeToOutput(filePath);
            relPathTS = writer.toPathForImport(relPathTS, false);
            this.sourceCode_header_TS += `\nimport c_${routeId} from "${relPathTS}";`;
            this.sourceCode_body_TS += `\n    await routeBindPage(webSite, c_${routeId}, ${JSON.stringify(routeBindingParams)});`;
        }

        const bindVerb = (writer: CodeGenWriter, verb: string, route: string, filePath: string, attributes: RouteAttributes) => {
            let srcFilePath = jk_fs.getRelativePath(this.cwdDir, filePath);

            const routeBindingParams: RouteBindVerbParams = {
                verb: verb as HttpMethod,
                route,
                filePath: srcFilePath,
                attributes: {
                    needRoles: attributes.needRoles,
                    disableCache: attributes.disableCache
                }
            };

            let routeId = "r" + (this.routeCount++);
            const toAddToBody = `\n    await routeBindVerb(webSite, f_${routeId}, ${JSON.stringify(routeBindingParams)});`;
            
            // >>> Javascript

            let compiledPath = jk_app.getCompiledFilePathFor(filePath);
            let relPathJS = writer.makePathRelativeToOutput(compiledPath);
            relPathJS = writer.toPathForImport(relPathJS, true);

            this.sourceCode_header_JS += `\nimport f_${routeId} from "${relPathJS}";`;
            this.sourceCode_body_JS += toAddToBody;
            
            // >>> Typescript
            
            let relPathTS = writer.makePathRelativeToOutput(filePath);
            relPathTS = writer.toPathForImport(relPathTS, false);

            this.sourceCode_header_TS += `\nimport f_${routeId} from "${relPathTS}";`;
            this.sourceCode_body_TS += toAddToBody;
        }

        const registryValues = Object.values(this.registry);

        for (let item of registryValues) {
            if (item.verb === "PAGE") {
                bindPage(writer, item.route, item.filePath, item.attributes);
            } else {
                bindVerb(writer, item.verb, item.route, item.filePath, item.attributes);
            }
        }

        //endregion
        
        //region Declare all the routes config.
        
        if (Object.keys(this.routeConfig).length > 0) {
            this.sourceCode_header_TS += `\nimport {JopiRouteConfig} from "jopijs";`;
            this.sourceCode_header_JS += `\nimport {JopiRouteConfig} from "jopijs";`;

            let count = 1;

            for (let route of Object.keys(this.routeConfig)) {
                let routeAttributes = this.routeConfig[route];

                //region Merge page roles + all roles.

                // It's lines of type: await routeConfig(new JopiRouteConfig(...))
                
                let roles: string[] = [];

                let pageRoles = routeAttributes.needRoles?.["PAGE"];
                if (pageRoles) pageRoles.forEach(r => { if (!roles.includes(r)) roles.push(r) });

                let allRoles = routeAttributes.needRoles?.[""];
                if (allRoles) allRoles.forEach(r => { if (!roles.includes(r)) roles.push(r) });

                let sRoles = roles.length ? ", " + JSON.stringify(roles) : ", undefined";

                //endregion
                
                const tmpRelPath = writer.makePathRelativeToOutput(routeAttributes.configFile!);

                // TS
                let relPathTS = tmpRelPath;
                relPathTS = writer.toPathForImport(relPathTS, false);
                
                // JS
                let relPathJS = tmpRelPath;
                relPathJS = writer.toPathForImport(relPathJS, true);

                
                this.sourceCode_header_TS += `\nimport routeConfig${count} from "${relPathTS}";`;
                this.sourceCode_header_JS += `\nimport routeConfig${count} from "${relPathJS}";`;
                
                const toAdd = `\n    await routeConfig${count}(new JopiRouteConfig(webSite, ${JSON.stringify(route)}${sRoles}));`;
                this.sourceCode_body_TS += toAdd;
                this.sourceCode_body_JS += toAdd;

                count++;
            }
        }

        //endregion

        //region Declare all page data provider

        // It's lines of type : setPageDataProvider(...);

        if (Object.keys(this.pageData).length > 0) {
            this.sourceCode_header_TS += `\nimport {setPageDataProvider} from "jopijs/generated";`;
            this.sourceCode_header_JS += `\nimport {setPageDataProvider} from "jopijs/generated";`;

            let count = 1;

            for (let route of Object.keys(this.pageData)) {
                let routeAttributes = this.pageData[route];

                //region Merge page roles + all roles.

                let roles: string[] = [];

                let pageRoles = routeAttributes.needRoles?.["PAGE"];
                if (pageRoles) pageRoles.forEach(r => { if (!roles.includes(r)) roles.push(r) });

                let allRoles = routeAttributes.needRoles?.[""];
                if (allRoles) allRoles.forEach(r => { if (!roles.includes(r)) roles.push(r) });

                //endregion

                let srcFilePath = jk_fs.getRelativePath(this.cwdDir, routeAttributes.pageData!);
                const tmpRelPath = writer.makePathRelativeToOutput(routeAttributes.pageData!);

                // TS
                let relPathTS = tmpRelPath;
                relPathTS = writer.toPathForImport(relPathTS, false);
                
                // JS
                let relPathJS = tmpRelPath;
                relPathJS = writer.toPathForImport(relPathJS, true);

                this.sourceCode_header_TS += `\nimport pageData${count} from "${relPathTS}";`;
                this.sourceCode_header_JS += `\nimport pageData${count} from "${relPathJS}";`;
                
                let line = `\n    setPageDataProvider(webSite, ${JSON.stringify(route)}, ${roles.length ? JSON.stringify(roles) : "undefined"}, pageData${count}, ${JSON.stringify(srcFilePath)});`;
                this.sourceCode_body_TS += line;
                this.sourceCode_body_JS += line;

                count++;
            }
        }

        //endregion

        const content_ts = `\n\nexport default async function(webSite: any) {${this.sourceCode_body_TS}\n}`;
        const content_js = `\n\nexport default async function(webSite) {${this.sourceCode_body_JS}\n}`;

        await writer.writeCodeFile({
            fileInnerPath: "declareServerRoutes",
            srcFileContent: writer.AI_INSTRUCTIONS + this.sourceCode_header_TS + content_ts,
            distFileContent: writer.AI_INSTRUCTIONS + this.sourceCode_header_JS + content_js
        });

        writer.genAddToInstallFile(InstallFileType.server, FilePart.imports, {
            ts: `\nimport declareRoutes from "./declareServerRoutes.ts";`,
            js: `\nimport declareRoutes from "./declareServerRoutes.js";`
        });

        writer.genAddToInstallFile(InstallFileType.server, FilePart.footer, {
            ts: "\n    onWebSiteCreated((webSite: any) => declareRoutes(webSite));",
            js: "\n    onWebSiteCreated((webSite) => declareRoutes(webSite));"
        });
    }

    /**
     * Generate the file .jopi-codegen/routes/index.ts
     * which allows knowing which route is handled by which component.
     */
    private async genCode_RouterFile(writer: CodeGenWriter) {
        const myDir = jk_fs.join(writer.dir.output_src, "routes");

        // Generate the code calling all the routes.
        //
        const generateRoutes = (sources: { header: string, body: string }, browserSide: boolean, forJavaScript: boolean) => {        
            if (browserSide) sources.header += `import React from "react";\n\n`;
            else sources.header += "\n";

            // For: import routes from "@/routes";
            // Export a map url --> page component.
            //
            sources.body += "\nconst routes = {";
            let count = 0;

            const registryValues = Object.values(this.registry);

            for (let item of registryValues) {
                if (item.verb === "PAGE") {
                    count++;

                    let relPath = jk_fs.getRelativePath(myDir, item.filePath);
                    relPath = writer.toPathForImport(relPath, forJavaScript);

                    if (browserSide) {
                        sources.body += `\n    "${item.route}": React.lazy(() => import(${JSON.stringify(relPath)})),`;
                    } else {
                        sources.header += `import I${count} from ${JSON.stringify(relPath)};\n`;
                        sources.body += `\n    "${item.route}": I${count},`;
                    }
                }
            }

            sources.body += "\n};\n\nexport default routes;";

            if (!browserSide) {
                sources.header += "\n";
            }
        }

        //region Common

        const commonTS = {
            header: writer.AI_INSTRUCTIONS + `import { jsx as _jsx } from "react/jsx-runtime";\n`,
            body: ""
        }
            ;
        
        const commonJS = { ...commonTS };

        commonTS.body += `function renderRoute(name: string) {
    let F = (routes as any)[name];
    if (!F) F = () => _jsx("div", { children: \`Error 404: put a @routes\${name}/page.tsx file for personalizing it\` });
    return _jsx(F, {});
}
`;

        commonJS.body += `function renderRoute(name) {
    let F = routes[name];
    if (!F) F = () => _jsx("div", { children: \`Error 404: put a @routes\${name}/page.tsx file for personalizing it\` });
    return _jsx(F, {});
}
`;

        //endregion

        //region jBundler_ifServer.ts/.js

        {
            // This error pages function allows bypassing the cache on sever-side.
            //
            let exportErrors = `
export function error404() {
    throw new SBPE_ErrorPage(404);
}

export function error500() {
   throw new SBPE_ErrorPage(500);
}

export function error401() {
    throw new SBPE_ErrorPage(401);
}
`;

            const sourcesTS = { ...commonTS };
            const sourcesJS = { ...commonJS };

            sourcesTS.header += `import { SBPE_ErrorPage } from "jopijs";\n`;
            sourcesJS.header += `import { SBPE_ErrorPage } from "jopijs";\n`;

            sourcesTS.body += exportErrors;
            sourcesJS.body += exportErrors;

            generateRoutes(sourcesTS, false, false);
            generateRoutes(sourcesJS, false, true);

            await writer.writeCodeFile({
                fileInnerPath: jk_fs.join("routes", "jBundler_ifServer"),
                srcFileContent: sourcesTS.header + sourcesTS.body,
                distFileContent: sourcesJS.header + sourcesJS.body,
            });
        }

        //endregion

        //region jBundler_ifBrowser.ts/.js

        {
            // On the browser side, render directly.
            let exportErrors = `
export function error404() {
    return renderRoute("/error404");
}

export function error500() {
   return renderRoute("/error500");
}

export function error401() {
    return renderRoute("/error401");
}
`;

            let sourcesTS = { ...commonTS };
            let sourcesJS = { ...commonJS };

            sourcesTS.body += exportErrors;
            sourcesJS.body += exportErrors;

            generateRoutes(sourcesTS, true, false);
            generateRoutes(sourcesJS, true, true);

            await writer.writeCodeFile({
                fileInnerPath: jk_fs.join("routes", "jBundler_ifBrowser"),
                srcFileContent: sourcesTS.header + sourcesTS.body,
                distFileContent: sourcesJS.header + sourcesJS.body,
            });
        }

        //endregion

        await writer.writeCodeFile({
            fileInnerPath: jk_fs.join("routes", "index"),
            srcFileContent: `export * from "./jBundler_ifServer.ts";`,
            distFileContent: `export * from "./jBundler_ifServer.js";`,
        });
    }

    async processDir(p: { moduleDir: string; typeDir: string; genDir: string; }) {
        let dirAttributes = await this.scanAttributes(p.typeDir);

        if (dirAttributes.configFile) {
            this.mergeConfig("/", dirAttributes);
        }

        if (dirAttributes.pageData) {
            this.mergePageData("/", dirAttributes);
        }

        await this.scanDir(p.typeDir, "/", dirAttributes);
    }

    protected getDefaultFeatures(): Record<string, boolean> | undefined {
        return {
            autoCache: true
        };
    }

    protected onFeatureFileFound(feature: string): string | undefined {
        if (feature === "autocache") return "autoCache";
        if (feature === "cache") return "autoCache";
        return undefined;
    }

    protected normalizeConditionName(condName: string, filePath: string, ctx: any | undefined): string | undefined {
        return normalizeNeedRoleConditionName(condName, filePath, ctx,
            ["PAGE", "GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "ALL", "PATH"]);
    }

    private async scanAttributes(dirPath: string): Promise<RouteAttributes> {
        let dirInfos = await this.dir_extractInfos(dirPath, {
            allowConditions: true,
            requirePriority: true,
            requireRefFile: false
        });

        const res: RouteAttributes = {
            configFile: await resolveFile(dirPath, ["config.tsx", "config.ts"]),
            pageData: await resolveFile(dirPath, ["pageData.tsx", "pageData.ts"]),
            disableCache: (dirInfos.features?.["autoCache"] === false) ? true : undefined,
            priority: dirInfos.priority,
            dirInfos
        };

        if (dirInfos.conditionsContext && Object.values(dirInfos.conditionsContext!).length) {
            res.needRoles = dirInfos.conditionsContext;
        }

        return res;
    }

    private addToRegistry(item: RegistryItem) {
        const key = item.route + ' ' + item.verb;
        let current = this.registry[key];

        if (!current) {
            this.registry[key] = item;
            return;
        }

        let newPriority = item.attributes.priority || PriorityLevel.default;
        let currentPriority = current.attributes.priority || PriorityLevel.default;

        if (newPriority > currentPriority) {
            this.registry[key] = item;
        }
    }

    private async scanDir(dir: string, route: string, attributes: RouteAttributes) {
        let dirItems = await jk_fs.listDir(dir);

        for (let dirItem of dirItems) {
            if (dirItem.name[0] === '.') continue;

            // Ignore if starts with '_'.
            if (dirItem.name[0] === '_') continue;

            if (dirItem.isDirectory) {
                let segmentInfos = convertRouteSegment(dirItem.name);
                let newRoute = route === "/" ? route + segmentInfos.routePart : route + "/" + segmentInfos.routePart;
                let dirAttributes = await this.scanAttributes(dirItem.fullPath);

                if (segmentInfos.isCatchAll && segmentInfos.name) {
                    dirAttributes.catchAllSlug = segmentInfos.name;
                }

                if (dirAttributes.configFile) {
                    this.mergeConfig(newRoute, dirAttributes);
                }

                if (dirAttributes.pageData) {
                    this.mergePageData(newRoute, dirAttributes);
                }

                await this.scanDir(dirItem.fullPath, newRoute, dirAttributes);
            } else if (dirItem.isFile) {
                let name = dirItem.name;

                if (name.endsWith(".tsx") || name.endsWith(".ts")) {
                    let idx = name.lastIndexOf(".");
                    name = name.substring(0, idx);

                    let isAccepted = true;

                    switch (name) {
                        case "page":
                            this.addToRegistry({ verb: "PAGE", route, filePath: dirItem.fullPath, attributes: attributes });
                            break;
                        case "onGET":
                            this.addToRegistry({ verb: "GET", route, filePath: dirItem.fullPath, attributes: attributes });
                            break;
                        case "onPOST":
                            this.addToRegistry({ verb: "POST", route, filePath: dirItem.fullPath, attributes: attributes });
                            break;
                        case "onPUT":
                            this.addToRegistry({ verb: "PUT", route, filePath: dirItem.fullPath, attributes: attributes });
                            break;
                        case "onDELETE":
                            this.addToRegistry({ verb: "DELETE", route, filePath: dirItem.fullPath, attributes: attributes });
                            break;
                        case "onHEAD":
                            this.addToRegistry({ verb: "HEAD", route, filePath: dirItem.fullPath, attributes: attributes });
                            break;
                        case "onPATCH":
                            this.addToRegistry({ verb: "PATCH", route, filePath: dirItem.fullPath, attributes: attributes });
                            break;
                        case "onOPTIONS":
                            this.addToRegistry({ verb: "OPTIONS", route, filePath: dirItem.fullPath, attributes: attributes });
                            break;
                        default:
                            isAccepted = false;
                            break;
                    }

                    if (isAccepted) {
                        await this.onItemAccepted(attributes.dirInfos);
                    }
                }
            }
        }
    }

    mergeConfig(newRoute: string, dirAttributes: RouteAttributes) {
        let currentItem = this.routeConfig[newRoute];

        if (currentItem) {
            const currentPriority = currentItem.priority || PriorityLevel.default;
            const newPriority = dirAttributes.priority || PriorityLevel.default;

            if (newPriority > currentPriority) {
                this.routeConfig[newRoute] = dirAttributes;
            }

        } else {
            this.routeConfig[newRoute] = dirAttributes;
        }
    }

    private mergePageData(newRoute: string, dirAttributes: RouteAttributes) {
        let currentItem = this.pageData[newRoute];

        if (currentItem) {
            const currentPriority = currentItem.priority || PriorityLevel.default;
            const newPriority = dirAttributes.priority || PriorityLevel.default;

            if (newPriority > currentPriority) {
                this.pageData[newRoute] = dirAttributes;
            }

        } else {
            this.pageData[newRoute] = dirAttributes;
        }
    }
}

interface RegistryItem {
    verb: string;
    route: string;
    filePath: string;
    attributes: RouteAttributes;
}

function convertRouteSegment(segment: string): { routePart: string, isCatchAll?: boolean, name?: string } {
    // Allows handling routes of type [...] and [...slug].
    if (segment.startsWith("[") && segment.endsWith("]")) {
        segment = segment.substring(1, segment.length - 1);

        if (segment.startsWith("..")) {
            segment = segment.substring(2);
            while (segment[0] === ".") segment = segment.substring(1);

            return {
                routePart: "**",
                isCatchAll: true,
                name: segment.length ? segment : undefined
            };
        }

        return {
            routePart: ":" + segment,
            isCatchAll: false,
            name: segment
        };
    }

    return {
        routePart: segment
    };
}