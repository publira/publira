# RadioGroup

A radio button group component, implemented on top of [Base UI Radio Group](https://base-ui.com/r/components/radio-group).

## Usage

```tsx
import { RadioGroup } from "@publira/ui-components";

export default function Example() {
  return (
    <RadioGroup>
      <label>
        <input type="radio" name="option" value="option1" />
        Option 1
      </label>
      <label>
        <input type="radio" name="option" value="option2" />
        Option 2
      </label>
    </RadioGroup>
  );
}
```

## Subpath import

```tsx
import { RadioGroup } from "@publira/ui-components/radio-group";
```

## Props

Follows the props of Base UI Radio Group. See the [Base UI Radio Group documentation](https://base-ui.com/r/components/radio-group) for details.
