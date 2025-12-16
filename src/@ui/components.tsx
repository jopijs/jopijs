import React from "react";

//region Composite

type CompositeRenderer = (name: string) => React.ReactElement;

function defaultCompositeRenderer() {
    return <></>;
}

function resolveCompositeRenderer(): CompositeRenderer {
    let bound = (globalThis as any)["_JOPI_COMPOSITE_RENDERER_"];
    if (bound) return bound as CompositeRenderer;
    return defaultCompositeRenderer;
}

/**
 * -- Do not use --
 * Allows the server part to hook the composite renderer used.
 */
export function _setCompositeRenderer(r: CompositeRenderer) {
    gCompositeRenderer = r;
}

/**
 * This component allows inserting the value of a 'composite'.
 * A composite is an extension point for your UI, it allows
 * inserting a thing into a region of your UI by extending his
 * content through plugins.
 *
 * Composites are not defined through API!!!
 * When declaring a module, the engine scans your folder uiComposites.
 *
 * Example:
 * `/modules/myModule/uiComposite/page.logInError/extA.extension.tsx`
 * - `page.logInError` is the name of the composite you extend.
 * - `extA` is the name of the extension point (it has no usage).
 *
 * Inside `extA.extension.tsx` the default export is the component to insert.
 */
export function Composite({name}: {name: string}) {
    if (!gCompositeRenderer) gCompositeRenderer = resolveCompositeRenderer();
    return gCompositeRenderer(name);
}

let gCompositeRenderer: CompositeRenderer|undefined;

//endregion