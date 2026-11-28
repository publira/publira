# Field

The components that make up a form field: a label, a description, an error message, and the content.

`Field.Label` is associated with the control in the same `Field` through `for` / `id`, so clicking the label focuses that control. The id comes from the `Field`, so `Field.Label` takes no `htmlFor` and the control needs no `id`. A `Select` is the exception: its trigger is a button that opens a popup, so over a `Select` the label is a non-label element that names the trigger through `aria-labelledby`, and clicking it focuses the trigger without opening the popup. `field-control-association.test.tsx` asserts both for every control this package ships.

## Usage

```tsx
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";

export default function Example() {
  return (
    <Field.Root>
      <Field.Label>Your name</Field.Label>
      <Field.Content>
        <Input placeholder="Enter your name" />
      </Field.Content>
      <Field.Description>This is your display name</Field.Description>
    </Field.Root>
  );
}
```

## Subpath import

```tsx
import * as Field from "@publira/ui-components/field";
```

## Components

- `Field.Root` - The container for the whole field
- `Field.Label` - The label
- `Field.Description` - The description
- `Field.Error` - The error message
- `Field.Content` - The container that wraps the input control
