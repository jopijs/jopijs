export interface HtmlNode {
    tag: string;
    key: string;
    rel?: string;
    type?: string;
    href?: string;
    name?: string;
    content?: string;
    property?: string;
    charset?: string;
    src?: string;
}

/**
 * Create an HTML tag text from the node.
 */
export function htmlNodeToText(node: HtmlNode): string {
    const tag = node.tag;
    let text = "<" + tag;

    for (let key in node) {
        if (key==="content") continue;
        if (key==="tag") continue;

        text += " " + key + "=" + JSON.stringify((node as any)[key]);
    }

    if (node.content) {
        text += ">" + node.content + "</" + tag + ">";
    } else {
        switch (node.tag) {
            case "script":
                text += "></script>";
                break;
            default:
                text += " />";
        }
    }

    return text;
}

export function htmlNodesToText(nodes?: HtmlNode[]): string {
    if (!nodes) return "";
    return nodes.map(htmlNodeToText).join("\n");
}