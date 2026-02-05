import { exposeServerAction as core_exposeServerAction } from "jopijs/core";

export function exposeServerAction(serverAction: Function, name: string, securityUid: string, requiredRoles: string[]) {
    // Allows calling the server action from the url /_jopi/ds/securityUid.
    core_exposeServerAction(name, securityUid, serverAction, requiredRoles);
}