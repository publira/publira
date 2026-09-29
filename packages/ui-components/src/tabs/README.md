# Tabs

Tabs that show one panel at a time, implemented on top of [Base UI Tabs](https://base-ui.com/r/components/tabs).

## Usage

```tsx
import { Tabs, TabsList, TabsPanel, TabsTab } from "@publira/ui-components";

export default function Example() {
  return (
    <Tabs defaultValue="write">
      <TabsList>
        <TabsTab value="write">Write</TabsTab>
        <TabsTab value="preview">Preview</TabsTab>
      </TabsList>
      <TabsPanel value="write">{editor}</TabsPanel>
      <TabsPanel value="preview">{preview}</TabsPanel>
    </Tabs>
  );
}
```

## Subpath import

```tsx
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@publira/ui-components/tabs";
```

## Parts

| Part | Renders | Role |
| --- | --- | --- |
| `Tabs` | `<div>` | Holds the list and the panels, and owns the selected value (`value` / `defaultValue` / `onValueChange`) |
| `TabsList` | `<div role="tablist">` | The row of tabs |
| `TabsTab` | `<button role="tab">` | One tab, selected by its `value` |
| `TabsPanel` | `<div role="tabpanel">` | The panel shown for the tab with the same `value`. `keepMounted` leaves it in the DOM while it is hidden |

## Props

Follows the props of Base UI Tabs. See the [Base UI Tabs documentation](https://base-ui.com/r/components/tabs) for details.
