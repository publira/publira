# Combobox

検索可能な単一選択・複数選択コンポーネントです。[Base UI Combobox](https://base-ui.com/r/components/combobox) をベースに実装しています。

`Field` 配下では `id` を渡さなくても入力に一意な id が付き、同じ `Field` 内の `FieldLabel` の `for` がそれを指します。呼び出し側が `id` を渡した場合はその id を使います。

## 使用方法

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

| Prop | 型 | デフォルト | 説明 |
| --- | --- | --- | --- |
| `items` | `{ label: string; value: string }[]` | 必須 | 選択肢 |
| `value` | `string` / `string[]` | 必須 | 選択中の値。`MultiCombobox` は配列 |
| `onValueChange` | `(next) => void` | 必須 | 選択変更時 |
| `id` | `string` | 自動採番 | 入力の id。省略時は `FieldLabel` と自動で結びつく |
| `placeholder` / `searchPlaceholder` | `string` | `"検索"` | 未選択時のプレースホルダ |
| `emptyMessage` | `string` | `"一致する項目が見つかりません。"` | 一致なしの表示 |
| `disabled` | `boolean` | — | 無効化 |
| `className` | `string` | — | 入力（`MultiCombobox` は入力グループ）の className |
