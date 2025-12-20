import {PageController} from "./pageController.ts";
import React from "react";

export class PageModifier {
    constructor(private readonly controller: PageController) {
    }

    /**
     * Set the title of the page.
     * Works on the browser and server-side.
     */
    setPageTitle(title: string) {
        this.controller.setPageTitle(title);
    }

    /**
     * Add something to the page header.
     * Works on the server-side only.
     */
    addToHeader(key: string, entry: React.ReactNode) {
        this.controller.addToHeader(key, entry);
    }

    addLinkToHeader(props: any) {
        const key = String(gNextKey++);
        this.addToHeader(key, <link key={key}{...props} />);
    }

    setFavicon(url: string) {
        this.addLinkToHeader({rel: "icon", type: "image/x-icon", href: url});
    }

    /**
     * Add a CSS to the page header.
     * Will generate a <link rel="stylesheet" href="..."> tag.
     * Works on the server-side only.
     */
    addCssUrlToHeader(link: string, props?: any) {
        const key = String(gNextKey++);
        this.addToHeader(key, <link key={key} rel="stylesheet" href={link} {...props}/>);
    }

    /**
     * Add a CSS to the page header.
     * Will generate a <style type="text/css">...</style> tag.
     * Works on the server-side only.
     */
    addCssTextToHeader(cssText: string, props?: any) {
        const key = String(gNextKey++);
        this.addToHeader(key, <style key={key} type="text/css" {...props}>{cssText}</style>);
    }

    /**
     * Add a JavaScript to the page header.
     * Will generate a <script type="text/javascript">...</script> tag.
     * Works on the server-side only.
     */
    addJavascriptTextToHeader(javascript: string, props?: any) {
        const key = String(gNextKey++);
        this.addToHeader(key, <script key={key} type="text/javascript" dangerouslySetInnerHTML={{__html: javascript}} {...props}></script>);
    }

    /**
     * Add a JavaScript to the page header.
     * Will generate a <script type="text/javascript" src="url"></script> tag.
     * Works on the server-side only.
     */
    addJavascriptUrlToHeader(url: string, props?: any) {
        const key = String(gNextKey++);
        this.addToHeader(key, <script key={key} type="text/javascript" src={url} {...props}></script>);
    }

    /**
     * Add a Meta to the page header.
     * Will generate a <meta name="..." content="..."> tag.
     * Works on the server-side only.
     */
    addMetaToHeader(name: string, value: string, props?: any) {
        const key = String(gNextKey++);
        this.addToHeader(key, <meta key={key} name={name} content={value} {...props}/>);
    }

    /**
     * Add a Meta property to the page header.
     * Will generate a <meta property="..." content="..."> tag.
     * Works on the server-side only.
     */
    addMetaPropertyToHeader(prop: string, value: string, props?: any) {
        const key = String(gNextKey++);
        this.addToHeader(key, <meta key={key} property={prop} content={value} {...props}/>);
    }

    /**
     * Add properties to the <html> tag.
     * Works on the server-side only.
     */
    setHtmlTagProps(key: string, value: any) {
        this.controller.setHtmlTagProps(key, value);
    }

    /**
     * Add properties to the <body> tag.
     * Works on the server-side only.
     */
    setBodyTagProps(key: string, value: any) {
        this.controller.setBodyTagProps(key, value);
    }

    /**
     * Add properties to the <head> tag.
     * Works on the server-side only.
     */
    setHeadTagProps(key: string, value: any) {
        this.controller.setHeadTagProps(key, value);
    }
}

let gNextKey = 0;