# ActionForm

A form component that encapsulates `useActionState`. It gives Server Action error handling, the pending state, and success message display a single consistent shape.

## Usage

### Automatic mode

Pass a ReactNode as `children` and the component manages the returned message and the submit button for you. A success message is shown when the Action returns `{ ok: true, message }`. Pass `showSuccess={false}` to hide it.

```tsx
import { ActionForm } from "@publira/ui-components/action-form";

export default function Example() {
  return (
    <ActionForm action={myAction} submitLabel="Save" pendingLabel="Saving...">
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
          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}
          <Button disabled={isPending} type="submit">
            {isPending ? "Saving..." : "Save"}
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
    return { ok: false, message: "Enter an email address." };
  }
  // On success, either redirect() or return { ok: true, message: "..." }
  return { ok: true, message: "Saved." };
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
| `showSuccess` | `boolean` | `true` | Show a success message when the state is `{ ok: true }`. Pass `false` to suppress it |
| `className` | `string` | — | className of the `<form>` |
| `submitClassName` | `string` | — | className of the submit button |
| `submitVariant` | `ButtonProps["variant"]` | — | variant of the submit button |
| `disabled` | `boolean` | — | Disable the submit button |
