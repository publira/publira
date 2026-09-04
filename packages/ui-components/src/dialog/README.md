# Dialog

The dialog components, used for confirmation flows and detail views.

## Usage

```tsx
import { Button } from "@publira/ui-components/button";
import { ConfirmDialog } from "@publira/ui-components/dialog";

export default function Example() {
  return (
    <ConfirmDialog
      actionText="Delete"
      cancelText="Cancel"
      description="This cannot be undone."
      title="Delete this item?"
      trigger={<Button variant="destructive">Delete</Button>}
    />
  );
}
```

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

`actionText` and `cancelText` are required and hold no default: this package is shared by apps that resolve their locale in different ways, so it cannot read one itself and a default here would label both buttons in a fixed language.

## Props

See the implementation for the props of ConfirmDialog.
