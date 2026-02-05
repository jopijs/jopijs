import {CodeGenWriter, ModuleDirProcessor} from "./linkerEngine.ts";
import * as jk_fs from "jopi-toolkit/jk_fs";
import {JopiModuleInfo, updateWorkspaces} from "jopijs/modules";

/**
 * Create the modules package.json file.
 * Add them to the main package.json workspace.
 */
export default class ModPackageJson extends ModuleDirProcessor {
    override async generateCode(): Promise<void> {
        await updateWorkspaces();
    }
}