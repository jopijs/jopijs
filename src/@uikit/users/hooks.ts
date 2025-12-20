import {_usePage, type UiUserInfos} from "jopijs/ui";
import React from "react";

export function useLogOutUser(): ()=>void {
    const page = _usePage();

    return () => {
        page.logOutUser();
        page.onRequireRefresh();
    }
}

export function useUserStateRefresh() {
    const page = _usePage();

    return () => {
        page.refreshUserInfos();
        page.onRequireRefresh();
    }
}

/**
 * Returns true if the user has all the given roles.
 */
export function useUserHasAllRoles(roles: string[]): boolean {
    if (roles.length === 0) return true;

    let userInfos = useUserInfos();
    if (!userInfos) return false;

    let userRoles = userInfos.roles;
    if (!userRoles) return false;

    return !!roles.every(role => userRoles.includes(role));
}

/**
 * Returns true if the user has at least one of the given roles.
 */
export function useUserHasOneOfThisRoles(roles: string[]): boolean {
    if (roles.length === 0) return false;

    let userInfos = useUserInfos();
    if (!userInfos) return false;

    let userRoles = userInfos.roles;
    if (!userRoles) return false;

    let found = roles.find(role => userRoles.includes(role));
    return (found !== undefined);
}

export function useUserInfos(): UiUserInfos|undefined {
    const page = _usePage();
    return page.getUserInfos();
}

export function CheckRoles({roles, children}: {
    roles: string[],
    children: React.ReactNode
}) {
    const isAllowed = useUserHasOneOfThisRoles(roles);
    if (isAllowed) return children;
    return null;
}