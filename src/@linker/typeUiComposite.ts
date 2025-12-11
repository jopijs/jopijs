import {TypeList} from "./coreAliasTypes.ts";

export default class TypeUiComposite extends TypeList {
    protected codeGen_generateExports(listAsArray: string) {
        let array = listAsArray.slice(1, -2).split(",");
        listAsArray = array.map(e => `        _jsx(${e}, {})`).join(", \n");
        let fct = `function p() {\n    return _jsxs(_Fragment, { children: [\n${listAsArray}\n    ]});\n}`;

        return "export default " + fct + ";";
    }

    protected codeGen_generateImports() {
        return `import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";\n`;
    }

    protected codeGen_createDeclarationTypes() {
        return `export default function p(): import("react/jsx-runtime").JSX.Element;`
    }
}