# Limit access to roles

Several features allow you to modify behaviors based on roles.

**On the React.js side**
* The `useUserHasRoles` hook returns a boolean indicating whether the user has all the roles specified in the parameter.
* The `CheckRoles` component allows you to wrap a component that will only be displayed if the user has the specified roles.

**In the `uiInit.ts` file**
* The `myModule.ifUserHasRoles` function allows you to execute a function if the user has all the specified roles.

In request processing (GET/POST/...)
* The `req.role_getUserRoles` function allows you to know the user's roles by returning an array containing the names of their roles.
* The `req.role_userHasRoles` function returns a boolean indicating whether the user has all the specified roles.
* Throwing an `SBPE_NotAuthorizedException` exception causes a 401 (unauthorized) response.
* The `req.role_assertUserHasRoles` function throws an `SBPE_NotAuthorizedException` exception if the user does not have all the specified roles.
