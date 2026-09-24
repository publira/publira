# Select

A select box (dropdown) component, implemented on top of [Base UI Select](https://base-ui.com/r/components/select).

## Usage

```tsx
import {
  Field,
  FieldContent,
  FieldLabel,
  Select,
} from "@publira/ui-components";

const items = [
  { label: "Japanese", value: "ja" },
  { label: "English", value: "en" },
];

export default function Example() {
  return (
    <Field>
      <FieldLabel>Default language</FieldLabel>
      <FieldContent>
        <Select
          items={items}
          name="default_locale"
          placeholder="Select a language"
        />
      </FieldContent>
    </Field>
  );
}
```

## Subpath import

```tsx
import { Select } from "@publira/ui-components/select";
```

## Props

Follows the props of Base UI's `Select.Root`, except for:

- `items` (required): the options, each a `{ label, value }` whose `value` is a string and whose `label` is any `ReactNode`. The component renders the trigger, the popup, and one item per entry itself, so it takes no `children`.
- `placeholder`: shown in the trigger while nothing is selected.
- `onValueChange`: called with the selected item's `value`, never `null`.
- `className`: applied to the trigger.
- `multiple`: not accepted; the component selects a single value.

See the [Base UI Select documentation](https://base-ui.com/r/components/select) for the rest.
