# Identifier

A public id, a ticket code, or any other value an operator reads off a detail screen and pastes somewhere else.

The value is set in the console's own sans face with tabular figures, not in a monospace one, and the exactness an operator needs comes from the copy control beside it. Identifiers belong on a detail screen; a list column shows the name a person recognises instead.

## Usage

```tsx
import * as Identifier from "@publira/ui-components/identifier";

export default function Example() {
  return (
    <Identifier.Root>
      <Identifier.Value>{user.publicId}</Identifier.Value>
      <Identifier.Copy aria-label="Copy the public ID" value={user.publicId} />
    </Identifier.Root>
  );
}
```

## Subpath import

```tsx
import * as Identifier from "@publira/ui-components/identifier";
```

## Props

`Identifier.Root` takes the props of a `<div>`. `Identifier.Copy` takes the exact `value` the clipboard receives and the `aria-label` that names it, because the control is an icon on its own.
