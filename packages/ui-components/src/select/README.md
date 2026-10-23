# Select

A select box (dropdown) component, implemented on top of [Base UI Select](https://base-ui.com/r/components/select).

## Usage

```tsx
import * as Field from "@publira/ui-components/field";
import { Select } from "@publira/ui-components/select";

const items = [
  { label: "Japanese", value: "ja" },
  { label: "English", value: "en" },
];

export default function Example() {
  return (
    <Field.Root>
      <Field.Label>Default language</Field.Label>
      <Field.Content>
        <Select
          items={items}
          name="default_locale"
          placeholder="Select a language"
        />
      </Field.Content>
    </Field.Root>
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
