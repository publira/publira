# ActionForm

`useActionState` をカプセル化したフォームコンポーネントです。Server Action のエラーハンドリング・送信中状態・成功メッセージ表示を統一的に扱えます。

## 使用方法

### 自動モード

`children` に ReactNode を渡すだけで、エラー表示と送信ボタンを自動管理します。

```tsx
import { ActionForm } from "@publira/ui-components/action-form";

export default function Example() {
  return (
    <ActionForm action={myAction} submitLabel="送信" pendingLabel="送信中...">
      <input name="email" type="email" />
    </ActionForm>
  );
}
```

### レンダー関数モード

ボタン配置やメッセージ表示をカスタマイズしたい場合、`children` に関数を渡します。

```tsx
import { ActionForm } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";

export default function Example() {
  return (
    <ActionForm action={myAction}>
      {({ isPending, state }) => (
        <>
          <input name="email" type="email" />
          {state && !state.ok && (
            <FormMessage variant="destructive">{state.message}</FormMessage>
          )}
          <Button disabled={isPending} type="submit">
            {isPending ? "送信中..." : "送信"}
          </Button>
        </>
      )}
    </ActionForm>
  );
}
```

### Server Action での型の使用

```ts
"use server";

import type { FormActionState } from "@publira/ui-components/action-form";

export const myAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { ok: false, message: "メールアドレスを入力してください。" };
  }
  // 成功時は redirect() するか { ok: true, message: "..." } を返す
  return { ok: true, message: "送信しました。" };
};
```

## Subpath import

```tsx
import { ActionForm } from "@publira/ui-components/action-form";
import type { FormActionState } from "@publira/ui-components/action-form";
```

## Props

| Prop | 型 | デフォルト | 説明 |
| --- | --- | --- | --- |
| `action` | `(prevState, formData) => Promise<FormActionState>` | 必須 | Server Action |
| `children` | `ReactNode \| (props) => ReactNode` | 必須 | フォーム内容。関数を渡すとレンダー関数モード |
| `submitLabel` | `string` | — | 自動モードの送信ボタンテキスト |
| `pendingLabel` | `string` | `submitLabel` | 送信中のボタンテキスト |
| `showSuccess` | `boolean` | `false` | `{ ok: true }` 時に成功メッセージを表示 |
| `className` | `string` | — | `<form>` の className |
| `submitClassName` | `string` | — | 送信ボタンの className |
| `submitVariant` | `ButtonProps["variant"]` | — | 送信ボタンの variant |
| `disabled` | `boolean` | — | 送信ボタンを無効化 |
