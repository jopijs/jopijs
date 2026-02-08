import { _usePage } from "./hooks";

/**
 * Create the usePageData hook for a page.
 */
export function createUsePageData<F extends (t: any) => Promise<any>>(serverAction: F) {
    type T = Parameters<F>[0];
    type V = Awaited<ReturnType<F>>;

    return (...args: Parameters<F>) => {
        return  _usePage().usePageData<T, V>(serverAction as any, args[0] as T);
    };
}