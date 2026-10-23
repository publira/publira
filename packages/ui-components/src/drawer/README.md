# Drawer

A sheet along the right edge of the viewport, for the detail of one row of a list. The list stays where it was behind the backdrop, and the sheet is dismissed with Escape, a click on the backdrop, a swipe back to the edge, or a `Drawer.Close`.

## Usage

```tsx
import { Button } from "@publira/ui-components/button";
import * as Drawer from "@publira/ui-components/drawer";

export default function Example() {
  return (
    <Drawer.Root>
      <Drawer.Trigger render={<Button variant="outline">View</Button>} />
      <Drawer.Content>
        <Drawer.Header>
          <Drawer.Title>Purchase</Drawer.Title>
          <Drawer.Close render={<Button variant="outline">Close</Button>} />
        </Drawer.Header>
        {/* The record's detail */}
      </Drawer.Content>
    </Drawer.Root>
  );
}
```

`Drawer.Root` takes Base UI's Root props, so a screen that keeps the open row in its URL passes `open` and navigates away in `onOpenChange`. This package is shared by apps that resolve their locale in different ways, so it words nothing of its own: the title and the close button's label come from the caller.

## Subpath import

```tsx
import * as Drawer from "@publira/ui-components/drawer";
```
