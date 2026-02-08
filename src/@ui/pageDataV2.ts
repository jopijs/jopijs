import { _usePage } from "./hooks";

/**
 * Create the usePageData hook for a page.
 */
export function createUsePageData<T, V>(serverAction: (t?: T) => Promise<V>) {
    return (t?: T) => {
        return  _usePage().usePageData<T, V>(serverAction, t);
    };
}