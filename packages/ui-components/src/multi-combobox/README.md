# MultiCombobox

A searchable multi-select component, implemented on top of [Base UI Combobox](https://base-ui.com/r/components/combobox). Each selected value is a chip in the input, and selecting one value is a [`Combobox`](../combobox).

It is composed in the same way as `Combobox`, so the wording of every chip, of the control that removes it, and of the empty list sits on the element that shows it.

## Usage

```tsx
import * as Field from "@publira/ui-components/field";
import * as MultiCombobox from "@publira/ui-components/multi-combobox";
import { useState } from "react";

const items = [
  { label: "Apple", value: "apple" },
  { label: "Orange", value: "orange" },
];

export default function Example() {
  const [creators, setCreators] = useState<string[]>([]);

  return (
    <Field.Root>
      <Field.Label>Authors</Field.Label>
      <Field.Content>
        <MultiCombobox.Root
          items={items}
          onValueChange={setCreators}
          value={creators}
        >
          <MultiCombobox.InputGroup>
            <MultiCombobox.Chips>
              {(selected) => (
                <>
                  {selected.map((item) => (
                    <MultiCombobox.Chip item={item} key={item.value}>
                      {item.label}
                      <MultiCombobox.ChipRemove aria-label="Remove" />
                    </MultiCombobox.Chip>
                  ))}
                  <MultiCombobox.Input
                    placeholder={selected.length > 0 ? "" : "Search authors"}
                  />
                </>
              )}
            </MultiCombobox.Chips>
          </MultiCombobox.InputGroup>
          <MultiCombobox.Popup>
            <MultiCombobox.Empty>No matching items.</MultiCombobox.Empty>
            <MultiCombobox.Items />
          </MultiCombobox.Popup>
        </MultiCombobox.Root>
      </Field.Content>
    </Field.Root>
  );
}
```

`MultiCombobox.Popup`, `MultiCombobox.Empty`, and `MultiCombobox.Items` are the same parts as `Combobox.Popup`, `Combobox.Empty`, and `Combobox.Items`: the popup is the same in either mode.

## Subpath import

```tsx
import * as MultiCombobox from "@publira/ui-components/multi-combobox";
```

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `items` | `{ label: string; value: string }[]` | Required | The available options |
| `value` | `string[]` | Required | The selected values |
| `onValueChange` | `(next) => void` | Required | Called when the selection changes |
| `id` | `string` | Generated | The id of the input. When omitted, it is associated with `Field.Label` automatically |
| `disabled` | `boolean` | — | Disable the control |

`MultiCombobox.Input` takes the input's own attributes — `placeholder`, and the `aria-label` that names the control where no `Field.Label` points at it — and `MultiCombobox.InputGroup` takes the `className` of the box that holds the chips.
