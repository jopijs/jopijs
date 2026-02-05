/**
 * Return a function which act a replacement for the real function.
 * Will proxy the call to the server.
 */
export function proxyServerAction(serverActionName: string, securityUid: string) {
    const url = "/_jopi/ds/" + securityUid;

    return async function(...args: any[]) {
        const res = await fetch(url, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ p: args }),
        });

        if (!res.ok) {
            if (res.status===401) throw new Error(`Access to server action ${serverActionName} is not authorized`);
            throw new Error(`Unknown server error when executing server action ${serverActionName}`);
        }

        const jsonServerResponse = await res.json();
        
        if (jsonServerResponse.error) {
            throw new Error(`Server action ${serverActionName}: ${jsonServerResponse.errorMessage}`, {cause: jsonServerResponse.errorStack});
        }

        return jsonServerResponse.r;
    };
}