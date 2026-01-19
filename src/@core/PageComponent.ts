import React from "react";
import {htmlNodesToText, PageContext, PageController_ExposePrivate} from "jopijs/ui";
import * as ReactServer from "react-dom/server";

export default function({children, controller}: { children: React.ReactNode|React.ReactNode[], controller: PageController_ExposePrivate<unknown> }) {
    let body = ReactServer.renderToStaticMarkup(
        React.createElement(PageContext.Provider, { value: controller }, children)
    );

    const state = controller.getOptions();

    body = "<div>" + body + "</div>";
    if (state.bodyBegin) {
        body = htmlNodesToText(state.bodyBegin) + body;
    }

    if (state.bodyEnd) {
        body += htmlNodesToText(state.bodyEnd);
    }

    let headText = htmlNodesToText(state.head);
    if (state.pageTitle!==undefined) headText += `<title>${state.pageTitle}</title>`;

    // noinspection HtmlRequiredTitleElement
    return React.createElement("html", state.htmlProps,
        React.createElement("head", { ...state.headProps, dangerouslySetInnerHTML: { __html: headText } }),
        React.createElement("body", { ...state.bodyProps, dangerouslySetInnerHTML: { __html: body } })
    );
}