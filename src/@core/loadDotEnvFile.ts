import {isNodeJS} from "jopi-toolkit/jk_what";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_process from "jopi-toolkit/jk_process";
import path from "node:path";
import * as Process from 'node:process';

if (isNodeJS) {
    let rootDir = jk_app.findPackageJsonDir();
    let envFile = path.join(rootDir, ".env");

    if (jk_fs.isFileSync(envFile)) {
        Process.loadEnvFile(envFile);
    } else {
        // development or production
        let nodeEnv = jk_process.isProduction ? "production" : "development";
        envFile = jk_fs.join(rootDir, ".env." + nodeEnv);

        if (jk_fs.isFileSync(envFile)) {
            Process.loadEnvFile(envFile);
        } else {
            envFile = path.join(rootDir, ".env.local");

            if (jk_fs.isFileSync(envFile)) {
                Process.loadEnvFile(envFile);
            }
        }
    }
}