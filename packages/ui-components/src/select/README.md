# Select

セレクトボックス（ドロップダウン）コンポーネントです。[Base UI Select](https://base-ui.com/r/components/select) をベースに実装しています。

## 使用方法

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

Base UI Select のプロップに準じます。詳細は [Base UI Select documentation](https://base-ui.com/r/components/select) を参照してください。
