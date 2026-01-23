import * as jk_crypto from "jopi-toolkit/jk_crypto";

export function calcCryptedUrl(route: string): string {
    return jk_crypto.md5(route + "todo_allowing_configuring_this_salt");
}