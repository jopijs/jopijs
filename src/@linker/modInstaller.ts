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
            relPath = writer.toPathForImport(relPath, !writer.isTypeScriptOnly);

            writer.genAddToInstallFile(InstallFileType.browser, FilePart.imports, `\nimport modUiInit${i} from "${relPath}";`);
            writer.genAddToInstallFile(InstallFileType.browser, FilePart.footer, `\n    modUiInit${i}(registry);`)
        }

        writer.genAddToInstallFile(InstallFileType.browser, FilePart.footer, `\n    registry.finalize();`)

        i = 0;

        for (let serverInitFile of this.serverInitFiles) {
            i++;

            let relPath = writer.makePathRelativeToOutput(serverInitFile);
            relPath = writer.toPathForImport(relPath, !writer.isTypeScriptOnly);

            writer.genAddToInstallFile(InstallFileType.server, FilePart.imports, `\nimport modServerInit${i} from "${relPath}";`);
            writer.genAddToInstallFile(InstallFileType.server, FilePart.body, `\n    await modServerInit${i}(registry);`)
        }
    }
}