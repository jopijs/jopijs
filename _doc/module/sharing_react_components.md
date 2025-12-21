# Sharing a React component

## The @alias/ui folder

This folder allows you to define and share React components between different modules. Everything you put in this folder will be accessible to other components via a very simple mechanism, which we will see here.

**Example of a shared component**
```
|- mod_moduleA/
   |- @alias/
      |- ui/
         |- page.header/           < The component name
            |- index.tsx           < Expose the component
            |- default.priority    < Automatically added if missing      
```

## Sharing a component

Here the component we have exposed is named `page.header`. Its content is defined in `index.tsx` as follows:

**Content of index.tsx**
```typescript jsx
export default function() {  
    return <div>Page Header</div>  
}
```

## Using a shared component

To access this component, from any module and any part of your code, you just need to do this.

**Using the shared component**
```typescript jsx
import PageHeader from "@/ui/page.header";

export default function() {  
    return <>
      <div>The header:</div>
      <PageHeader />
    </>  
}
```