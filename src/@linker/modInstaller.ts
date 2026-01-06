import {
    CodeGenWriter,
    FilePart,
    InstallFileType,
    ModuleDirProcessor,
    resolveFile
} from "./engine.ts";
import {JopiModuleInfo} from "../@modules/index.ts";

/**
 * Search the uiInstall.ts and serverInstall.ts files
 */
export default class ModInstaller extends ModuleDirProcessor {
    private uiInitFiles: string[] = [];
    private serverInitFiles: string[] = [];

    override async onBeginModuleProcessing(_writer: CodeGenWriter, module: JopiModuleInfo): Promise<void> {
        let uiInitFile = await resolveFile(module.fullPath, ["uiInit.tsx", "uiInit.ts"]);
        if (uiInitFile) this.uiInitFiles.push(uiInitFile);

        let serverInitFile = await resolveFile(module.fullPath, ["serverInit.tsx", "serverInit.ts"]);
        if (serverInitFile) this.serverInitFiles.push(serverInitFile);
    }

    override async generateCode(writer: CodeGenWriter): Promise<void> {
        let i = 0;

        for (let uiInitFile of this.uiInitFiles) {
            i++;

            let relPath = writer.makePathRelativeToOutput(uiInitFile);
            let relPathTS = writer.toPathForImport(relPath, false);
            let relPathJS = writer.toPathForImport(relPath, true);

            writer.genAddToInstallFile(InstallFileType.browser, FilePart.imports, {
                ts: `\nimport modUiInit${i} from "${relPathTS}";`,
                js: `\nimport modUiInit${i} from "${relPathJS}";`
            });

            writer.genAddToInstallFile(InstallFileType.browser, FilePart.footer, `\n    modUiInit${i}(registry);`)
        }

        writer.genAddToInstallFile(InstallFileType.browser, FilePart.footer, `\n    registry.finalize();`)

        i = 0;

        for (let serverInitFile of this.serverInitFiles) {
            i++;

            let relPath = writer.makePathRelativeToOutput(serverInitFile);
            let relPathTS = writer.toPathForImport(relPath, false);
            let relPathJS = writer.toPathForImport(relPath, true);

            writer.genAddToInstallFile(InstallFileType.server, FilePart.imports, {
                ts: `\nimport modServerInit${i} from "${relPathTS}";`,
                js: `\nimport modServerInit${i} from "${relPathJS}";`
            });
            
            writer.genAddToInstallFile(InstallFileType.server, FilePart.body, `\n    await modServerInit${i}(registry);`)
        }
    }
}