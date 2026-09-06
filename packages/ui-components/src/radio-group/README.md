# RadioGroup

A radio button group component, implemented on top of [Base UI Radio Group](https://base-ui.com/r/components/radio-group).

The options are data rather than children: each carries its own label, an optional sentence of explanation, and its own disabled state, and the component names every radio after that label. Base UI otherwise hands each radio the surrounding `Field`'s `aria-labelledby`, so a screen reader would announce every option with the field's name.

## Usage

```tsx
import { RadioGroup } from "@publira/ui-components";

const items = [
  {
    description: "Anyone can read the comment as soon as it is posted.",
    label: "Publish straight away",
    value: "immediate",
  },
  {
    description: "Only its author sees the comment until it is approved.",
    label: "Publish after approval",
    value: "approval_required",
  },
];

export default function Example() {
  return <RadioGroup items={items} name="comment_mode" />;
}
```

## Subpath import

```tsx
import { RadioGroup } from "@publira/ui-components/radio-group";
```

## Props

`items` is this component's own; everything else follows the props of Base UI Radio Group. See the [Base UI Radio Group documentation](https://base-ui.com/r/components/radio-group) for details.

| Prop | Type | What it is |
| --- | --- | --- |
| `items` | `readonly { value: string; label: ReactNode; description?: ReactNode; disabled?: boolean }[]` | The options, in the order they are offered |
| `className` | `string` | Classes for the group |
| `itemClassName` | `string` | Classes for each option's row |
