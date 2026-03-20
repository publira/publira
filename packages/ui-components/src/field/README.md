# Field

フォームフィールドを構成するコンポーネント群です。ラベル、説明文、エラーメッセージ、コンテンツから構成されます。

## 使用方法

```tsx
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldContent,
  Input,
} from "@publira/ui-components";

export default function Example() {
  return (
    <Field>
      <FieldLabel>Your name</FieldLabel>
      <FieldContent>
        <Input placeholder="Enter your name" />
      </FieldContent>
      <FieldDescription>This is your display name</FieldDescription>
    </Field>
  );
}
```

## Subpath import

```tsx
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldContent,
} from "@publira/ui-components/field";
```

## コンポーネント一覧

- `Field` - フィールド全体のコンテナ
- `FieldLabel` - ラベル
- `FieldDescription` - 説明文
- `FieldError` - エラーメッセージ
- `FieldContent` - 入力フィールドを囲むコンテナ
