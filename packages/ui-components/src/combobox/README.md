# Combobox

A searchable single-select and multi-select component, implemented on top of [Base UI Combobox](https://base-ui.com/r/components/combobox).

Both are composed: the root owns the selection state and the parts the caller writes own everything a reader sees. Copy therefore reaches the element it belongs to as `children`, a `placeholder`, or an `aria-label`, and this package words nothing itself — it is shared by apps that resolve their locale in different ways.

## Usage

```tsx
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItems,
  ComboboxPopup,
  Field,
  FieldContent,
  FieldLabel,
  MultiCombobox,
  MultiComboboxChip,
  MultiComboboxChipRemove,
  MultiComboboxChips,
  MultiComboboxInput,
  MultiComboboxInputGroup,
} from "@publira/ui-components";
import { useState } from "react";

const items = [
  { label: "Apple", value: "apple" },
  { label: "Orange", value: "orange" },
];

export default function Example() {
  const [label, setLabel] = useState("");
  const [creators, setCreators] = useState<string[]>([]);

  return (
    <>
      <Field>
        <FieldLabel>Label</FieldLabel>
        <FieldContent>
          <Combobox items={items} onValueChange={setLabel} value={label}>
            <ComboboxInput placeholder="Search labels" />
            <ComboboxPopup>
              <ComboboxEmpty>No matching items.</ComboboxEmpty>
              <ComboboxItems />
            </ComboboxPopup>
          </Combobox>
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel>Creators</FieldLabel>
        <FieldContent>
          <MultiCombobox
            items={items}
            onValueChange={setCreators}
            value={creators}
          >
            <MultiComboboxInputGroup>
              <MultiComboboxChips>
                {(selected) => (
                  <>
                    {selected.map((item) => (
                      <MultiComboboxChip item={item} key={item.value}>
                        {item.label}
                        <MultiComboboxChipRemove aria-label="Remove" />
                      </MultiComboboxChip>
                    ))}
                    <MultiComboboxInput
                      placeholder={selected.length > 0 ? "" : "Search creators"}
                    />
                  </>
                )}
              </MultiComboboxChips>
            </MultiComboboxInputGroup>
            <ComboboxPopup>
              <ComboboxEmpty>No matching items.</ComboboxEmpty>
              <ComboboxItems />
            </ComboboxPopup>
          </MultiCombobox>
        </FieldContent>
      </Field>
    </>
  );
}
```

`ComboboxPopup`, `ComboboxEmpty`, and `ComboboxItems` serve both roots — the popup is the same in either mode.

## Subpath import

```tsx
import { Combobox, MultiCombobox } from "@publira/ui-components/combobox";
```

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `items` | `{ label: string; value: string }[]` | Required | The available options |
| `value` | `string` / `string[]` | Required | The selected value. `MultiCombobox` takes an array |
| `onValueChange` | `(next) => void` | Required | Called when the selection changes |
| `id` | `string` | Generated | The id of the input. When omitted, it is associated with `FieldLabel` automatically |
| `disabled` | `boolean` | — | Disable the control |

`ComboboxInput` and `MultiComboboxInput` take the input's own attributes — `placeholder`, and the `aria-label` that names the control where no `FieldLabel` points at it; `ComboboxInput` takes a `className` too, and `MultiComboboxInputGroup` takes the `className` of the box that holds the chips.
