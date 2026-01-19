import type {HttpMethod} from "./jopiCoreWebSite.ts";

export function octetToMo(size: number) {
    const res = size / ONE_MEGA_OCTET;
    return Math.trunc(res * 100) / 100;
}

export const ONE_MINUTE = 1000 * 60;
export const ONE_HOUR = ONE_MINUTE * 60;
export const ONE_DAY = ONE_HOUR * 24;
export const ONE_KILO_OCTET = 1024;
export const ONE_MEGA_OCTET = 1024 * ONE_KILO_OCTET;

export const HTTP_VERBS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];