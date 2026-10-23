# Fieldset

A group of fields that is closed as one. `disabled` closes every control inside it: the controls this package ships, whether or not they sit in a `Field`, every native control (`<button>`, `<input>`, `<textarea>`), and the `ConfirmDialog.Action` of a `ConfirmDialog` inside it, whose popup is portaled out of the `<fieldset>`. A nested `Fieldset` cannot reopen what an outer one closed.

It renders a `<fieldset>` with no border, margin, or padding, so the layout classes it takes are the ones a wrapping `<div>` would have taken.

## Usage

```tsx
import * as Field from "@publira/ui-components/field";
import { Fieldset } from "@publira/ui-components/fieldset";
import { Input } from "@publira/ui-components/input";

export const Example = ({ isPending }: { isPending: boolean }) => (
  <Fieldset className="grid gap-4" disabled={isPending}>
    <Field.Root>
      <Field.Label>Title</Field.Label>
      <Field.Content>
        <Input name="title" />
      </Field.Content>
    </Field.Root>
  </Fieldset>
);
```

## Subpath import

```tsx
import { Fieldset } from "@publira/ui-components/fieldset";
```

## Components

- `Fieldset` - The group; `disabled` closes every control inside it
