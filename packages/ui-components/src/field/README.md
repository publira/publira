# Field

The components that make up a form field: a label, a description, an error message, and the content.

`FieldLabel` is associated with the control in the same `Field` through `for` / `id`, so clicking the label focuses that control. `field-control-association.test.tsx` asserts it for every control this package ships.

## Usage

```tsx
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldContent,
  Input,
} from "@publira/ui-components";

export default function Example() {
  return (
    <Field>
      <FieldLabel>Your name</FieldLabel>
      <FieldContent>
        <Input placeholder="Enter your name" />
      </FieldContent>
      <FieldDescription>This is your display name</FieldDescription>
    </Field>
  );
}
```

## Subpath import

```tsx
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldContent,
} from "@publira/ui-components/field";
```

## Components

- `Field` - The container for the whole field
- `FieldLabel` - The label
- `FieldDescription` - The description
- `FieldError` - The error message
- `FieldContent` - The container that wraps the input control
