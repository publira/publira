# Dialog

The dialog components, used for confirmation flows and detail views.

## Usage

```tsx
import { Button } from "@publira/ui-components/button";
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from "@publira/ui-components/dialog";

export default function Example() {
  return (
    <ConfirmDialog>
      <ConfirmDialogTrigger
        render={<Button variant="destructive">Delete</Button>}
      />
      <ConfirmDialogContent>
        <ConfirmDialogHeader>
          <ConfirmDialogTitle>Delete this item?</ConfirmDialogTitle>
          <ConfirmDialogDescription>
            This cannot be undone.
          </ConfirmDialogDescription>
        </ConfirmDialogHeader>
        <ConfirmDialogFooter>
          <ConfirmDialogCancel>Cancel</ConfirmDialogCancel>
          <ConfirmDialogAction onClick={remove}>Delete</ConfirmDialogAction>
        </ConfirmDialogFooter>
      </ConfirmDialogContent>
    </ConfirmDialog>
  );
}
```

`ConfirmDialog` is composed, so the wording of the two footer buttons sits on the buttons themselves. This package is shared by apps that resolve their locale in different ways, so it words nothing of its own.

`ConfirmDialogAction` closes the dialog and runs `onClick`; its `variant` defaults to `destructive`. `ConfirmDialogCancel` only closes it.

To confirm a Server Action, pass `form` instead of `onClick`: the action becomes a submit button for the form with that id (`ActionForm` takes an `id`). The popup is portaled out of any surrounding `<form>`, so the id is what connects the two, and the form and its copy can stay in a Server Component.

## Subpath import

```tsx
import {
  ConfirmDialog,
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@publira/ui-components/dialog";
```
