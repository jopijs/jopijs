import {declareLinkerError} from "./linkerEngine.ts";

function ucFirst(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

export function normalizeNeedRoleConditionName(condName: string, filePath: string, ctx: any|undefined, acceptedTargets: string[]): string|undefined {
    let needRoleIdx = condName.toLowerCase().indexOf("needrole");
    if (needRoleIdx===-1) return undefined;

    let target = condName.substring(0, needRoleIdx).toUpperCase();

    if (target) {
        if (!acceptedTargets.includes(target)) {
            throw declareLinkerError(`Condition target ${target} is unknown`, filePath);
        }
    } else {
        target = "ALL";
    }

    let role = condName.substring(needRoleIdx + 8).toLowerCase();

    if (!ctx[target]) ctx[target] = [role];
    else ctx[target].push(role);

    target = target.toLowerCase();
    return target + "NeedRole_" + ucFirst(role);
}