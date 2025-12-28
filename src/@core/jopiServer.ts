// noinspection JSUnusedGlobalSymbols

import path from "node:path";

import fs from "node:fs/promises";
import { ServerAlreadyStartedError, type SslCertificatePath, type CoreWebSite, CoreWebSiteImpl } from "./jopiCoreWebSite.tsx";

import * as jk_app from "jopi-toolkit/jk_app";
import * as jk_fs from "jopi-toolkit/jk_fs";
import * as jk_os from "jopi-toolkit/jk_os";
import * as jk_tools from "jopi-toolkit/jk_tools";

class JopiServer {
    private webSite?: CoreWebSiteImpl;
    private server?: CoreServer;
    private _isStarted = false;

    /**
     * Generate a certificat for dev test.
     * Require "mkcert" to be installed.
     * See: https://github.com/FiloSottile/mkcert
     */
    async createDevCertificate(hostName: string, certsDir: string = "certs"): Promise<SslCertificatePath> {
        const sslDirPath = path.resolve(certsDir, hostName);
        const keyFilePath = path.join(sslDirPath, "certificate.key");
        const certFilePath = path.join(sslDirPath, "certificate.crt.key");

        if (!await jk_fs.isFile(certFilePath)) {
            let mkCertToolPath = jk_os.whichSync("mkcert");

            if (mkCertToolPath) {
                await fs.mkdir(sslDirPath, { recursive: true });
                await jk_os.exec(`cd ${sslDirPath}; ${mkCertToolPath} -install; ${mkCertToolPath} --cert-file certificate.crt.key --key-file certificate.key ${hostName} localhost 127.0.0.1 ::1`);
            } else {
                throw "Can't generate certificate, mkcert tool not found. See here for installation: https://github.com/FiloSottile/mkcert";
            }
        }

        return { key: keyFilePath, cert: certFilePath };
    }

    setWebsite(webSite: CoreWebSite): CoreWebSite {
        if (this._isStarted) throw new ServerAlreadyStartedError();
        this.webSite = webSite as CoreWebSiteImpl;
        return webSite;
    }

    async stopServer(): Promise<void> {
        if (!this._isStarted) return;
        await this.server!.stop(false);
    }

    async startServer() {
        if (this._isStarted) return;
        this._isStarted = true;

        const webSite = this.webSite!;
        let certificates: any[] = [];

        function rebuildCertificates() {
            certificates = [];

            if (webSite.certificate) {
                const keyFile = path.resolve(webSite.certificate.key);
                const certFile = path.resolve(webSite.certificate.cert);

                certificates.push({
                    key: jk_fs.readTextFromFileSync(keyFile),
                    cert: jk_fs.readTextFromFileSync(certFile),
                    serverName: webSite.host
                });
            }
        }

        /**
         * Allow avoiding a bug where returning an array with only one certificate throws an error.
         */
        function selectCertificate(certificates: any[]): any | any[] | undefined {
            if (certificates.length === 0) return undefined;
            if (certificates.length === 1) return certificates[0];
            return certificates;
        }

        rebuildCertificates();

        webSite._onRebuildCertificate = () => {
            rebuildCertificates();

            let certificate = selectCertificate(certificates);
            webSite.serverInstanceBuilder.updateTlsCertificate(certificate);
        };

        await webSite.onBeforeServerStart();

        await jk_tools.killPort(String(webSite.port));

        this.server = await webSite.serverInstanceBuilder.startServer({
            port: webSite.port,
            tls: selectCertificate(certificates)
        });

        await webSite.onServerStarted();

        // Stop the server if the exit signal is received.
        jk_app.onAppExiting(() => {
            this.stopServer().catch();
        });
    }
}

export function getServerStartOptions(): StartServerCoreOptions {
    return gServerStartGlobalOptions;
}

export function getServer(): JopiServer {
    if (!gServerInstance) gServerInstance = new JopiServer();
    return gServerInstance;
}

export interface StartServerCoreOptions {
    /**
     * The timeout value for a request.
     * See: https://bun.sh/reference/bun/Server/timeout
     */
    timeout?: number;
}

export interface StartServerOptions extends StartServerCoreOptions {
    /**
     * The port to listen to.
     * The default is "3000".
     */
    port?: string;

    /**
     * The TLS certificate to use (for https).
     */
    tls?: TlsCertificate | TlsCertificate[],

    fetch: (req: Request) => Response | Promise<Response | undefined> | undefined;

    onWebSocketConnection?: (ws: WebSocket, infos: WebSocketConnectionInfos) => void;
}

export interface WebSocketConnectionInfos {
    headers: Headers;
    url: string;
}

export interface TlsCertificate {
    key: string;
    cert: string;
    serverName: string;
}

/**
 * Allows accessing to the core node.js / bun.js server.
 */
export interface CoreServer {
    requestIP(req: Request): ServerSocketAddress | null;
    timeout(req: Request, seconds: number): void;
    stop(closeActiveConnections: boolean): Promise<void>;
}

export interface ServerSocketAddress {
    /**
     * The IP address of the client.
     */
    address: string;
    /**
     * The port of the client.
     */
    port: number;
    /**
     * The IP family ("IPv4" or "IPv6").
     */
    family: "IPv4" | "IPv6";
}

export interface SseEvent {
    getWelcomeMessage: () => string;
    handler: (controller: SseEventController) => void;
}

export interface SseEventController {
    send(eventName: string, data: string): void;
    close(): void;
}

let gServerInstance: JopiServer | undefined;
const gServerStartGlobalOptions: StartServerCoreOptions = {};