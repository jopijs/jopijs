# Create a module

## What are modules?

Modules allow you to break down your applications into functional units. You can think of it as an application with a base and plugins that enrich it.

For example, one module defines the site structure (the layout with a top menu, a user menu on the right, a central area, and a footer), while another module adds a product catalog (e-commerce), and another module adds a contact page.

Here we have three decoupled parts, with the advantage that:
* You know where to look for what, in a well-defined area.
* If you work in a team, each person works on a part without overlapping.

Although separated into logical units, modules are not entirely partitioned:
* An event system allows communication between modules by sending messages and responding to them.
* A system allows making elements public, which means other modules can use them. For example, React.js components and data schemas.
* A third mechanism allows creating lists that each module can enrich. For example, for a list of icons to display under the "Add to cart" button of a product.

## How to create a module?

A module is a folder at the root of the `src/` directory containing your sources, and its name must start with `mod_`. You just need to create such a folder to create a module.

**Project Example**
```
|- src/
	|- mod_moduleA    < First module 
	|- mod_moduleB    < Second module
```

## Inside a module

A module folder contains specific elements whose names might surprise you.

**Module Content**
```
|- mod_moduleA/
	|- @alias/                  < For sharing items though modules, allowing: 
	   |- ui/               import "@/ui/myBlock"
	   |- uiComposites/               import "@/uiComposites/myComp"
	   |- events/                     import "@/events/myEvent"
	|- @routes/                 < Define the routes
	|- uiInit.tsx               < Called on page render
	|- serverInit.ts            < Called on server start
```
## The "serverInit.ts" file

This file is called by the server on startup. Each module has such a file.

**Example of a serverInit.ts file**
```typescript
import type {JopiEasyWebSite} from "jopijs";    
import {JopiRequest} from "jopijs";  

async function printIp(req: JopiRequest) {  
    console.log("Caller IP is", ip);
    return null; 
}  
  
export default async function(webSite: JopiEasyWebSite) {  
    // ...
}
```

## The "uiInit.ts" file

This file is called for each page render. It is called on the server side when it creates the page's visual and it is called by the browser when the page loads.

**Example of a uiInit.tsx file**
```typescript jsx
import {UiKitModule, MenuName} from "jopijs/uikit";  
  
// myModule is of type UiApplication.
// But is upgradedto UiKitModule if you use
// uiKit features, which is near always the case.
//
export default function(myModule: UiKitModule) {  
	console.log("I'm called immediatly.");

    myModule.addUiInitializer(() => {  
        console.log("I'm called when all module are loaded");
    });
}
```