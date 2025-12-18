import {isServerSide} from "jopi-toolkit/jk_what";
import {getCookieValue} from "./cookies/index.ts";

export interface UiUserInfos {
    id: string;

    roles?: string[];
    email?: string;

    fullName?: string;
    nickName?: string;

    firstName?: string;
    lastName?: string;

    avatarUrl?: string;

    [key: string]: any;
}

export function decodeJwtToken(jwtToken: string|undefined): UiUserInfos|undefined {
    if (!jwtToken) return undefined;

    const parts = jwtToken.split('.');
    if (parts.length !== 3) return undefined;

    const payload = parts[1];
    const decodedPayload = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodedPayload) as UiUserInfos;
}

export function isUserInfoCookieUpdated(): boolean {
    const jwtToken = getCookieValue("authorization");
    return jwtToken !== gAuthorizationCookiePreviousValue;
}

export function decodeUserInfosFromCookie(): UiUserInfos|undefined {
    if (isServerSide) {
        return undefined;
    }

    let jwtToken = getCookieValue("authorization");
    gAuthorizationCookiePreviousValue = jwtToken;

    return decodeJwtToken(jwtToken);
}

let gAuthorizationCookiePreviousValue: string|undefined = undefined;