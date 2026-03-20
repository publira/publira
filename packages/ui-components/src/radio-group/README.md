# RadioGroup

ラジオボタングループコンポーネントです。[Base UI Radio Group](https://base-ui.com/r/components/radio-group) をベースに実装しています。

## 使用方法

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

Base UI Radio Group のプロップに準じます。詳細は [Base UI Radio Group documentation](https://base-ui.com/r/components/radio-group) を参照してください。
