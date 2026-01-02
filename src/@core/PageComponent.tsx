import React from "react";
import {htmlNodesToText, PageContext, PageController_ExposePrivate} from "jopijs/ui";
import * as ReactServer from "react-dom/server";

export default function({children, controller}: { children: React.ReactNode|React.ReactNode[], controller: PageController_ExposePrivate<unknown> }) {
    let body = ReactServer.renderToStaticMarkup(
        <PageContext.Provider value={controller}>
            {children}
        </PageContext.Provider>
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
    return <html {...state.htmlProps}>
        <head {...state.headProps} dangerouslySetInnerHTML={{__html: headText}}>
        </head>
        <body {...state.bodyProps} dangerouslySetInnerHTML={{ __html: body }} />
    </html>
}