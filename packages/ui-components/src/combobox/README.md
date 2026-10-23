# Combobox

A searchable single-select component, implemented on top of [Base UI Combobox](https://base-ui.com/r/components/combobox). Selecting several values is a [`MultiCombobox`](../multi-combobox).

It is composed: the root owns the selection state and the parts the caller writes own everything a reader sees. Copy therefore reaches the element it belongs to as `children`, a `placeholder`, or an `aria-label`, and this package words nothing itself — it is shared by apps that resolve their locale in different ways.

## Usage

```tsx
import * as Combobox from "@publira/ui-components/combobox";
import * as Field from "@publira/ui-components/field";
import { useState } from "react";

const items = [
  { label: "Apple", value: "apple" },
  { label: "Orange", value: "orange" },
];

export default function Example() {
  const [label, setLabel] = useState("");

  return (
    <Field.Root>
      <Field.Label>Label</Field.Label>
      <Field.Content>
        <Combobox.Root items={items} onValueChange={setLabel} value={label}>
          <Combobox.Input placeholder="Search labels" />
          <Combobox.Popup>
            <Combobox.Empty>No matching items.</Combobox.Empty>
            <Combobox.Items />
          </Combobox.Popup>
        </Combobox.Root>
      </Field.Content>
    </Field.Root>
  );
}
```

## Subpath import

```tsx
import * as Combobox from "@publira/ui-components/combobox";
```

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `items` | `{ label: string; value: string }[]` | Required | The available options |
| `value` | `string` | Required | The selected value |
| `onValueChange` | `(next) => void` | Required | Called when the selection changes |
| `id` | `string` | Generated | The id of the input. When omitted, it is associated with `Field.Label` automatically |
| `disabled` | `boolean` | — | Disable the control |

`Combobox.Input` takes the input's own attributes — `placeholder`, `className`, and the `aria-label` that names the control where no `Field.Label` points at it.
