# Dialog

A modal dialog for a detail view or a form that does not fit on the screen behind it, implemented on top of [Base UI Dialog](https://base-ui.com/r/components/dialog). A dialog that only asks for confirmation before an action is a [`ConfirmDialog`](../confirm-dialog).

## Usage

```tsx
import { Button } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";

export default function Example() {
  return (
    <Dialog.Root>
      <Dialog.Trigger render={<Button variant="outline">Edit</Button>} />
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup>
            <Dialog.Header>
              <Dialog.Title>Edit the reason</Dialog.Title>
              <Dialog.Description>
                The reason is shown to the commenter.
              </Dialog.Description>
            </Dialog.Header>
            {/* The form */}
            <Dialog.Footer>
              <Dialog.Close
                render={<Button variant="outline">Cancel</Button>}
              />
            </Dialog.Footer>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

`Dialog.Root`, `Dialog.Trigger`, `Dialog.Portal`, `Dialog.Viewport`, `Dialog.Title`, `Dialog.Description`, and `Dialog.Close` are Base UI's own parts and take its props. `Dialog.Backdrop` and `Dialog.Popup` add this package's surface to Base UI's, and `Dialog.Header` and `Dialog.Footer` take the props of a `<div>`. This package is shared by apps that resolve their locale in different ways, so it words nothing of its own.

## Subpath import

```tsx
import * as Dialog from "@publira/ui-components/dialog";
```
