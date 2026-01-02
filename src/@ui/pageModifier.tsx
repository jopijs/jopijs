import {PageController} from "./pageController.ts";
import {type HtmlNode} from "./htmlNode.ts";

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
    private addToHeader(item: HtmlNode) {
        this.controller.addToHeader(item);
    }

    addLinkToHeader(props: Omit<HtmlNode, 'tag' | 'key'>) {
        const key = String(gNextKey++);
        this.addToHeader({...props, tag: "link", key});
    }

    setFavicon(url: string) {
        this.addLinkToHeader({rel: "icon", type: "image/x-icon", href: url});
    }

    /**
     * Add a CSS to the page header.
     * Will generate a <link rel="stylesheet" href="..."> tag.
     * Works on the server-side only.
     */
    addCssUrlToHeader(link: string) {
        this.addLinkToHeader({rel: "stylesheet", href: link});
    }

    /**
     * Add a CSS to the page header.
     * Will generate a <style type="text/css">...</style> tag.
     * Works on the server-side only.
     */
    addCssTextToHeader(cssText: string) {
        this.addLinkToHeader({type: "text/css", content: cssText});
    }

    /**
     * Add a JavaScript to the page header.
     * Will generate a <script type="text/javascript">...</script> tag.
     * Works on the server-side only.
     */
    addJavascriptTextToHeader(javascript: string) {
        const key = String(gNextKey++);
        this.addToHeader({tag: "script", type: "text/javascript", content: javascript, key});
    }

    /**
     * Add a JavaScript to the page header.
     * Will generate a <script type="text/javascript" src="url"></script> tag.
     * Works on the server-side only.
     */
    addJavascriptUrlToHeader(url: string) {
        const key = String(gNextKey++);
        this.addToHeader({tag: "script", type: "text/javascript", src: url, key});
    }

    /**
     * Add a Meta to the page header.
     * Will generate a <meta name="..." content="..."> tag.
     * Works on the server-side only.
     */
    addMetaToHeader(name: string, content: string) {
        const key = String(gNextKey++);
        this.addToHeader({key, tag: "meta", name, content});
    }

    /**
     * Add a Meta property to the page header.
     * Will generate a <meta property="..." content="..."> tag.
     * Works on the server-side only.
     */
    addMetaPropertyToHeader(prop: string, content: string) {
        const key = String(gNextKey++);
        this.addToHeader({key, tag: "meta", property: prop, content});
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