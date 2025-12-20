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
import type {RouteAttributes} from "jopijs/generated";
import {normalizeNeedRoleConditionName} from "./common.ts";

export default class TypeRoutes extends AliasType {
    private sourceCode_header = `import {routeBindPage, routeBindVerb} from "jopijs/generated";`;
    private sourceCode_body = "";
    private outputDir: string = "";
    private cwdDir: string = process.cwd();
    private routeCount: number = 1;

    private registry: Record<string, RegistryItem> = {};
    private routeConfig: Record<string, RouteAttributes> = {};

    async beginGeneratingCode(writer: CodeGenWriter): Promise<void> {
        await this.genCode_AliasRoutes(writer);
        await this.genCode_DeclareServerRoutes(writer);
    }

    private async genCode_DeclareServerRoutes(writer: CodeGenWriter) {
        if (Object.keys(this.routeConfig).length>0) {
            this.sourceCode_header += `\nimport {RouteConfig} from "jopijs";`;

            let count = 1;

            for (let route of Object.keys(this.routeConfig)) {
                let routeAttributes = this.routeConfig[route];
                let relPath = jk_fs.getRelativePath(writer.dir.output_dir, routeAttributes.configFile!);
                relPath = jk_fs.win32ToLinuxPath(relPath);

                // Merge page roles + all roles.
                let roles: string[] = [];

                let pageRoles = routeAttributes.needRoles?.["PAGE"];
                if (pageRoles) pageRoles.forEach(r => { if (!roles.includes(r)) roles.push(r) });

                let allRoles = routeAttributes.needRoles?.[""];
                if (allRoles) allRoles.forEach(r => { if (!roles.includes(r)) roles.push(r) });

                let sRoles = roles.length ? ", " + JSON.stringify(roles) : "";
                this.sourceCode_header += `\nimport routeConfig${count} from "${relPath}";`;
                this.sourceCode_body += `\n    await routeConfig${count}(new RouteConfig(webSite, ${JSON.stringify(route)}${sRoles}));`;

                count++;
            }
        }

        this.sourceCode_body = `\n\nexport default async function(webSite) {${this.sourceCode_body}\n}`;

        let filePath = jk_fs.join(writer.dir.output_dir, "declareServerRoutes.js");
        await writeTextToFileIfMismatch(filePath, writer.AI_INSTRUCTIONS + this.sourceCode_header + this.sourceCode_body);

        writer.genAddToInstallFile(InstallFileType.server, FilePart.imports, `\nimport declareRoutes from "./declareServerRoutes.js";`);
        writer.genAddToInstallFile(InstallFileType.server, FilePart.footer, "\n    onWebSiteCreated((webSite) => declareRoutes(webSite));");
    }

    private async genCode_AliasRoutes(writer: CodeGenWriter) {
        const myDir = jk_fs.join(writer.dir.output_src, "routes");

        const generateRoutes = (browserSide: boolean) => {
            // For: import routes from "@/routes";
            // Export a map url --> page component.
            //
            let srcRouteFiles =
                `import React from "react";

export default {`;

            let headers = writer.AI_INSTRUCTIONS;
            let count = 0;

            for (let item of Object.values(this.registry)) {
                if (item.verb==="PAGE") {
                    count++;

                    let relPath = jk_fs.getRelativePath(myDir, item.filePath);
                    relPath = writer.toPathForImport(relPath, false);

                    if (browserSide) {
                        srcRouteFiles += `\n    "${item.route}": React.lazy(() => import(${JSON.stringify(relPath)})),`;
                    } else {
                        headers += `import I${count} from ${JSON.stringify(relPath)};\n`;
                        srcRouteFiles += `\n    "${item.route}": I${count},`;
                    }

                    this.bindPage(writer, item.route, item.filePath, item.attributes);
                } else {
                    this.bindVerb(writer, item.verb, item.route, item.filePath, item.attributes);
                }
            }

            srcRouteFiles += "\n};";

            return headers + srcRouteFiles;
        }

        const routesBrowserSide = generateRoutes(true);

        let srcCommon =
`import { jsx as _jsx } from "react/jsx-runtime";
import routes from "./jBundler_ifServer.ts";
export * as routes from "./jBundler_ifServer.ts";
`;

        srcCommon += `

function renderRoute(name: string) {
    let F = (routes as any)[name];
    if (!F) F = () => _jsx("div", { children: \`Error 404: put a @routes\${name}/page.tsx file for personalizing it\` });
    return _jsx(F, {});
}

export function error404() {
    return renderRoute("/error404");
}

export function error500() {
   return renderRoute("/error500");
}

export function error401() {
    return renderRoute("/error401");
}`;

        await writer.writeCodeFile({
            fileInnerPath: jk_fs.join("routes", "index"),
            srcFileContent: srcCommon,
            distFileContent: srcCommon
        });

        await writer.writeCodeFile({
            fileInnerPath: jk_fs.join("routes", "jBundler_ifBrowser"),
            srcFileContent: routesBrowserSide,
            distFileContent: routesBrowserSide
        });

        const routesServerSide = generateRoutes(false);

        await writer.writeCodeFile({
            fileInnerPath: jk_fs.join("routes", "jBundler_ifServer"),
            srcFileContent: routesServerSide,
            distFileContent: routesServerSide
        });
    }

    async processDir(p: { moduleDir: string; typeDir: string; genDir: string; }) {
        this.outputDir = getWriter().dir.output_dir;

        let dirAttributes = await this.scanAttributes(p.typeDir);
        //
        if (dirAttributes.configFile) {
            this.routeConfig["/"] = dirAttributes;
        }

        await this.scanDir(p.typeDir, "/", dirAttributes);
    }

    private bindPage(writer: CodeGenWriter, route: string, filePath: string, attributes: RouteAttributes) {
        let routeId = "r" + (this.routeCount++);
        let srcFilePath = jk_fs.getRelativePath(this.cwdDir, filePath);

        filePath = jk_app.getCompiledFilePathFor(filePath);
        let distFilePath = jk_fs.getRelativePath(this.outputDir, filePath);
        distFilePath = writer.toPathForImport(distFilePath, false);

        let routeBindingParams = {route, attributes, filePath: srcFilePath};

        this.sourceCode_header += `\nimport c_${routeId} from "${distFilePath}";`;
        this.sourceCode_body += `\n    await routeBindPage(webSite, c_${routeId}, ${JSON.stringify(routeBindingParams)});`
    }

    private bindVerb(writer: CodeGenWriter, verb: string, route: string, filePath: string, attributes: RouteAttributes) {
        let routeId = "r" + (this.routeCount++);
        let relPath = jk_fs.getRelativePath(this.outputDir, filePath);
        relPath = writer.toPathForImport(relPath, false);

        let routeBindingParams = {verb, route, attributes, filePath};
        this.sourceCode_header += `\nimport f_${routeId} from "${relPath}";`;
        this.sourceCode_body += `\n    await routeBindVerb(webSite, f_${routeId}, ${JSON.stringify(routeBindingParams)});`
    }

    protected getDefaultFeatures(): Record<string, boolean>|undefined {
        return {
            autoCache: true
        };
    }

    protected onFeatureFileFound(feature: string): string|undefined {
        if (feature==="autocache") return "autoCache";
        if (feature==="cache") return "autoCache";
        return undefined;
    }

    protected normalizeConditionName(condName: string, filePath: string, ctx: any|undefined): string|undefined {
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
            disableCache: (dirInfos.features?.["autoCache"] === false) ? true : undefined,
            priority: dirInfos.priority,
            dirInfos
        };

        if (dirInfos.conditionsContext && Object.values(dirInfos.conditionsContext!).length) {
            res.needRoles =  dirInfos.conditionsContext;
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

        if (newPriority>currentPriority) {
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
                let newRoute = route==="/" ? route + segmentInfos.routePart : route + "/" + segmentInfos.routePart;
                let dirAttributes = await this.scanAttributes(dirItem.fullPath);

                if (segmentInfos.isCatchAll && segmentInfos.name) {
                    dirAttributes.catchAllSlug = segmentInfos.name;
                }

                if (dirAttributes.configFile) {
                    let currentItem = this.routeConfig[newRoute];

                    if (currentItem) {
                        const currentPriority = currentItem.priority || PriorityLevel.default;
                        const newPriority = dirAttributes.priority || PriorityLevel.default;

                        if (newPriority>currentPriority) {
                            this.routeConfig[newRoute] = dirAttributes;
                        }

                    } else {
                        this.routeConfig[newRoute] = dirAttributes;
                    }
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
                            this.addToRegistry({verb: "PAGE", route, filePath: dirItem.fullPath, attributes: attributes});
                            break;
                        case "onGET":
                            this.addToRegistry({verb: "GET", route, filePath: dirItem.fullPath, attributes: attributes});
                            break;
                        case "onPOST":
                            this.addToRegistry({verb: "POST", route, filePath: dirItem.fullPath, attributes: attributes});
                            break;
                        case "onPUT":
                            this.addToRegistry({verb: "PUT", route, filePath: dirItem.fullPath, attributes: attributes});
                            break;
                        case "onDELETE":
                            this.addToRegistry({verb: "DELETE", route, filePath: dirItem.fullPath, attributes: attributes});
                            break;
                        case "onHEAD":
                            this.addToRegistry({verb: "HEAD", route, filePath: dirItem.fullPath, attributes: attributes});
                            break;
                        case "onPATCH":
                            this.addToRegistry({verb: "PATCH", route, filePath: dirItem.fullPath, attributes: attributes});
                            break;
                        case "onOPTIONS":
                            this.addToRegistry({verb: "OPTIONS", route, filePath: dirItem.fullPath, attributes: attributes});
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
}

interface RegistryItem {
    verb: string;
    route: string;
    filePath: string;
    attributes: RouteAttributes;
}

function convertRouteSegment(segment: string): {routePart: string, isCatchAll?: boolean, name?: string} {
    if (segment.startsWith("[") && segment.endsWith("]")) {
        segment = segment.substring(1, segment.length - 1);

        if (segment.startsWith("..")) {
            segment = segment.substring(2);
            while (segment[0]===".") segment=segment.substring(1);

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