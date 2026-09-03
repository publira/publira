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
  { label: "りんご", value: "apple" },
  { label: "みかん", value: "orange" },
];

export default function Example() {
  const [label, setLabel] = useState("");
  const [creators, setCreators] = useState<string[]>([]);

  return (
    <>
      <Field>
        <FieldLabel>レーベル</FieldLabel>
        <FieldContent>
          <Combobox items={items} onValueChange={setLabel} value={label} />
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel>クリエイター</FieldLabel>
        <FieldContent>
          <MultiCombobox
            items={items}
            onValueChange={setCreators}
            value={creators}
          />
        </FieldContent>
      </Field>
    </>
  );
}
```

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
| `placeholder` / `searchPlaceholder` | `string` | `"検索"` | Placeholder shown while nothing is selected |
| `emptyMessage` | `string` | `"一致する項目が見つかりません。"` | Shown when nothing matches |
| `disabled` | `boolean` | — | Disable the control |
| `className` | `string` | — | className of the input (of the input group for `MultiCombobox`) |
