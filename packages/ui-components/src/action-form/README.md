# ActionForm

A form component that encapsulates `useActionState`. It gives Server Action error handling, the pending state, and success message display a single consistent shape.

## Usage

### Automatic mode

Pass a ReactNode as `children` and the component manages error display and the submit button for you.

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

### Render function mode

Pass a function as `children` when you want to customize button placement or message display.

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

### Using the types in a Server Action

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
  // On success, either redirect() or return { ok: true, message: "..." }
  return { ok: true, message: "送信しました。" };
};
```

## Subpath import

```tsx
import { ActionForm } from "@publira/ui-components/action-form";
import type { FormActionState } from "@publira/ui-components/action-form";
```

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `action` | `(prevState, formData) => Promise<FormActionState>` | Required | The Server Action |
| `children` | `ReactNode \| (props) => ReactNode` | Required | Form content. Passing a function switches to render function mode |
| `submitLabel` | `string` | — | Submit button text in automatic mode |
| `pendingLabel` | `string` | `submitLabel` | Button text while the submission is pending |
| `showSuccess` | `boolean` | `false` | Show a success message when the state is `{ ok: true }` |
| `className` | `string` | — | className of the `<form>` |
| `submitClassName` | `string` | — | className of the submit button |
| `submitVariant` | `ButtonProps["variant"]` | — | variant of the submit button |
| `disabled` | `boolean` | — | Disable the submit button |
