import type { CoreWebSite } from "./jopiCoreWebSite.ts";
import type { JopiRequest } from "./jopiRequest.ts";
import type { JopiRouteHandler } from "./routes.ts";

/**
 * Base class for exceptions that modify the control flow of the server request processing.
 * These are caught by the server to trigger specific behaviors (redirect, error page, etc.)
 * rather than being treated as standard runtime errors.
 */
export class SBPE_ServerByPassException extends Error {
}

export class SBPE_ErrorPage extends SBPE_ServerByPassException {
    constructor(public readonly code: number) {
        super("error");
    }

    async apply(webSite: CoreWebSite, req: JopiRequest): Promise<Response> {
        try {
            switch (this.code) {
                case 404:
                    return webSite.return404(req);
                case 500:
                    return webSite.return500(req);
                case 401:
                    return webSite.return401(req);
            }
        }
        catch {
        }

        return webSite.return500(req);
    }
}

/**
 * Exception thrown to indicate that the current user does not have the required permissions.
 * Triggers the 401 Unauthorized handler.
 */
export class SBPE_NotAuthorizedException extends SBPE_ServerByPassException {
}

/**
 * Exception thrown to immediately send a specific response, bypassing the rest of the route logic.
 */
export class SBPE_DirectSendThisResponseException extends SBPE_ServerByPassException {
    constructor(public readonly response: Response | JopiRouteHandler) {
        super();
    }
}

/**
 * Exception thrown to stop request processing without sending any response.
 * Useful when the response has already been handled by other means (e.g. raw socket).
 */
export class SBPE_MustReturnWithoutResponseException extends SBPE_ServerByPassException {
    constructor() {
        super();
    }
}

/**
 * Error thrown when attempting to start a server that is already running.
 */
export class ServerAlreadyStartedError extends Error {
    constructor() {
        super("the server is already");
    }
}
