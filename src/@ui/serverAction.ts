/**
 * Return a function which act a replacement for the real function.
 * Will proxy the call to the server.
 */
export function proxyServerAction(_name: string, securityUid: string) {
    const url = "/_jopi/ds/" + securityUid;

    return async function(...args: any[]) {
        const res = await fetch(url, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ p: args }),
        });

        if (!res.ok) {
            throw new Error("Unknown server error");
        }

        const jsonServerResponse = await res.json();
        
        if (jsonServerResponse.error) {
            throw new Error(jsonServerResponse.errorMessage, {cause: jsonServerResponse.errorStack});
        }

        let functionResult = jsonServerResponse.r;

        return functionResult;
    };
}