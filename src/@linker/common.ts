import {declareLinkerError} from "./engine.ts";

export function normalizeNeedRoleConditionName(condName: string, filePath: string, ctx: any|undefined, acceptedTargets: string[]): string|undefined {
    let needRoleIdx = condName.toLowerCase().indexOf("needrole");
    if (needRoleIdx===-1) return undefined;

    let target = condName.substring(0, needRoleIdx).toUpperCase();

    if (!acceptedTargets.includes(target)) {
        throw declareLinkerError(`Condition target ${target} is unknown`, filePath);
    }

    let role = condName.substring(needRoleIdx + 8).toLowerCase();
    if ((role[0]==='_')||(role[0]==='-')) role = role.substring(1);

    if (!ctx[target]) ctx[target] = [role];
    else ctx[target].push(role);

    target = target.toLowerCase();
    return target + "NeedRole_" + role;
}