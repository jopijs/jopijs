import {type UserInfos, type CoreWebSite} from "./jopiCoreWebSite.ts";

export interface UserLoginPassword {
    login: string;
    password: string;
}

export interface UserInfos_WithLoginPassword extends UserLoginPassword {
    userInfos: UserInfos;
}

export class UserStore_WithLoginPassword {
    public readonly users: UserInfos_WithLoginPassword[] = [];

    add(infos: UserInfos_WithLoginPassword) {
        this.users.push(infos);
    }

    setAuthHandler(webSite: CoreWebSite) {
        webSite.setAuthHandler<UserLoginPassword>(loginInfo => {
            let foundUser = this.users.find(e => e.login===loginInfo.login);

            if (!foundUser) {
                return {isOk: false, errorMessage: "Unknown user"};
            }

            if (loginInfo.password!==foundUser.password) {
                return {isOk: false, errorMessage: "Wrong password"};
            }

            return {isOk: true, userInfos: foundUser.userInfos};
        })
    }
}
