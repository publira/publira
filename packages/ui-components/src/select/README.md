# Select

A select box (dropdown) component, implemented on top of [Base UI Select](https://base-ui.com/r/components/select).

## Usage

```tsx
import { Select } from "@publira/ui-components";

export default function Example() {
  return (
    <Select defaultValue="option1">
      <option value="option1">Option 1</option>
      <option value="option2">Option 2</option>
      <option value="option3">Option 3</option>
    </Select>
  );
}
```

## Subpath import

```tsx
import { Select } from "@publira/ui-components/select";
```

## Props

Follows the props of Base UI Select. See the [Base UI Select documentation](https://base-ui.com/r/components/select) for details.
