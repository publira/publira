# ConfirmDialog

A dialog that asks for confirmation before an action, implemented on top of [Base UI Alert Dialog](https://base-ui.com/r/components/alert-dialog).

## Usage

```tsx
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";

export default function Example() {
  return (
    <ConfirmDialog.Root>
      <ConfirmDialog.Trigger
        render={<Button variant="destructive">Delete</Button>}
      />
      <ConfirmDialog.Content>
        <ConfirmDialog.Header>
          <ConfirmDialog.Title>Delete this item?</ConfirmDialog.Title>
          <ConfirmDialog.Description>
            This cannot be undone.
          </ConfirmDialog.Description>
        </ConfirmDialog.Header>
        <ConfirmDialog.Footer>
          <ConfirmDialog.Cancel>Cancel</ConfirmDialog.Cancel>
          <ConfirmDialog.Action onClick={remove}>Delete</ConfirmDialog.Action>
        </ConfirmDialog.Footer>
      </ConfirmDialog.Content>
    </ConfirmDialog.Root>
  );
}
```

`ConfirmDialog` is composed, so the wording of the two footer buttons sits on the buttons themselves. This package is shared by apps that resolve their locale in different ways, so it words nothing of its own.

`ConfirmDialog.Action` closes the dialog and runs `onClick`; its `variant` defaults to `destructive`. `ConfirmDialog.Cancel` only closes it.

To confirm a Server Action, pass `form` instead of `onClick`: the action becomes a submit button for the form with that id (`ActionForm` takes an `id`). The popup is portaled out of any surrounding `<form>`, so the id is what connects the two, and the form and its copy can stay in a Server Component.

## Subpath import

```tsx
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
```
