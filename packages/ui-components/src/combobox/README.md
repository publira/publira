# Combobox

A searchable single-select and multi-select component, implemented on top of [Base UI Combobox](https://base-ui.com/r/components/combobox).

## Usage

```tsx
import {
  Combobox,
  Field,
  FieldContent,
  FieldLabel,
  MultiCombobox,
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
          <Combobox
            emptyMessage="No matching items."
            items={items}
            onValueChange={setLabel}
            value={label}
          />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel>Creators</FieldLabel>
        <FieldContent>
          <MultiCombobox
            emptyMessage="No matching items."
            items={items}
            onValueChange={setCreators}
            removeLabel="Remove"
            value={creators}
          />
        </FieldContent>
      </Field>
    </>
  );
}
```

The copy props are required and hold no default: this package is shared by apps that resolve their locale in different ways, so it cannot read one itself and a default here would word part of the control in a fixed language. Resolve each string from the caller's catalog.

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
| `emptyMessage` | `string` | Required | Shown when nothing matches |
| `removeLabel` | `string` | Required (`MultiCombobox`) | Accessible name of the button that drops one selected chip |
| `id` | `string` | Generated | The id of the input. When omitted, it is associated with `FieldLabel` automatically |
| `placeholder` / `searchPlaceholder` | `string` | — | Placeholder shown while nothing is selected |
| `disabled` | `boolean` | — | Disable the control |
| `className` | `string` | — | className of the input (of the input group for `MultiCombobox`) |
