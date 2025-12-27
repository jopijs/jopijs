import fs from "node:fs/promises";
import path from "node:path";

const myPlugin = {
    name: "jopi-replace-text",

    setup(build) {
        build.onLoad({filter: /\.(tsx|ts|js|jsx)$/}, async ({path: p2}) => {
            const oldContent = await fs.readFile(p2, 'utf8');
            let newContent = oldContent.replaceAll("jBundler_ifServer", "jBundler_ifBrowser");
            const loader = path.extname(p2).toLowerCase().substring(1);
            return {contents: newContent, loader: loader};
        });
    }
}

export default myPlugin;