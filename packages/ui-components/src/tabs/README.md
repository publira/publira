# Tabs

Tabs that show one panel at a time, implemented on top of [Base UI Tabs](https://base-ui.com/r/components/tabs).

## Usage

```tsx
import * as Tabs from "@publira/ui-components/tabs";

export default function Example() {
  return (
    <Tabs.Root defaultValue="write">
      <Tabs.List>
        <Tabs.Tab value="write">Write</Tabs.Tab>
        <Tabs.Tab value="preview">Preview</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="write">{editor}</Tabs.Panel>
      <Tabs.Panel value="preview">{preview}</Tabs.Panel>
    </Tabs.Root>
  );
}
```

## Subpath import

```tsx
import * as Tabs from "@publira/ui-components/tabs";
```

## Parts

| Part | Renders | Role |
| --- | --- | --- |
| `Tabs.Root` | `<div>` | Holds the list and the panels, and owns the selected value (`value` / `defaultValue` / `onValueChange`) |
| `Tabs.List` | `<div role="tablist">` | The row of tabs |
| `Tabs.Tab` | `<button role="tab">` | One tab, selected by its `value` |
| `Tabs.Panel` | `<div role="tabpanel">` | The panel shown for the tab with the same `value`. `keepMounted` leaves it in the DOM while it is hidden |

## Props

Follows the props of Base UI Tabs. See the [Base UI Tabs documentation](https://base-ui.com/r/components/tabs) for details.
