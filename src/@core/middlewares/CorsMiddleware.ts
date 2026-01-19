import type {JopiPostMiddleware} from "../jopiCoreWebSite.ts";

export interface CorsMiddlewareOptions {
    accessControlAllowOrigin?: string[];
}

export default function(options: CorsMiddlewareOptions): JopiPostMiddleware {
    let accessControlAllowOrigin: string|undefined;
    if (options.accessControlAllowOrigin) {
        // Make it easier when setting urls.
        const values = options.accessControlAllowOrigin.map(v => new URL(v).origin);

        accessControlAllowOrigin = values.join(",");
    }

    return (req, res) => {
        if (accessControlAllowOrigin) {
            res.headers.set("Access-Control-Allow-Origin", accessControlAllowOrigin);
        }

        return res;
    };
}