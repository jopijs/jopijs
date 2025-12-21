# Replacing a shared component

Each module can expose React components that other modules can use. Sometimes, for the needs of your application, you might want to replace a component with another version.

To replace a component, you just need to declare a component with the same name and give it a higher priority.

```
|- mod_moduleA
|  |- @alias/ui/page.header
|     |- index.tsx
|     |- default.priority          < Automatically added if no priority
|- mod_moduleB
|  |- @alias/ui/page.header
|     |- index.tsx
|     |- high.priority             < Is higher priority
```

Here, the `page.header` component from moduleB has a higher priority. That's why its version of the component will be the one used.

The different priority levels are:
* verylow.priority
* low.priority
* default.priority
* high.priority
* veryhigh.priority

The system supports several naming variations for these files. It converts the name to lowercase and removes hyphens and underscores. So you can write `Very-Low.priority` or `very_low.priority`. They will automatically be renamed to `verylow.priority`.

The benefit of the `verylow` and `low` levels is that an element without a priority, which means a `default` priority level, will automatically override the existing one. Using `verylow` and `low` is therefore a way to define a default value for an element.