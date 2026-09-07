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
