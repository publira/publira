# ActionForm

A form component that encapsulates `useActionState`. It gives Server Action error handling, the pending state, and success message display a single consistent shape.

The fields are reset when the Action returns `{ ok: true }` and keep what was typed when it returns `{ ok: false }`, so a refused submission is corrected rather than filled in again.

## Usage

### Node mode

Pass a ReactNode as `children`. The message the Action returns is rendered for you; the submit control is one of the children, so its wording, its classes, and its variant sit on the element itself. A success message is shown when the Action returns `{ ok: true, message }` — pass `showSuccess={false}` to hide it.

```tsx
import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";

export default function Example() {
  return (
    <ActionForm action={myAction}>
      <input name="email" type="email" />
      <ActionFormSubmit className="w-full">
        <ActionFormIdle>Save</ActionFormIdle>
        <ActionFormPending>Saving...</ActionFormPending>
      </ActionFormSubmit>
    </ActionForm>
  );
}
```

`ActionFormIdle` and `ActionFormPending` render only while the form is idle and only while its Action is in flight. A control whose wording does not change while submitting takes plain children instead.

`ActionFormFieldset` is a `Fieldset` that is also closed while the Action is in flight. Wrap the fields the form submits in it; a control independent of the submission, such as one that opens an unrelated dialog, can stay outside.

```tsx
<ActionForm action={myAction} className="grid gap-4">
  <ActionFormFieldset className="grid gap-4">
    <Field>...</Field>
  </ActionFormFieldset>
  <ActionFormSubmit>Save</ActionFormSubmit>
</ActionForm>
```

### Render function mode

Pass a function as `children` when you want to place the message yourself or read the state the Action returned.

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
| `showSuccess` | `boolean` | `true` | Show a success message when the state is `{ ok: true }`. Pass `false` to suppress it |
| `className` | `string` | — | className of the `<form>` |
| `id` | `string` | — | id of the `<form>`, for a submit control outside it to name with `form` (such as `ConfirmDialogAction`) |

`ActionFormSubmit` takes the submit button's own `children`, `className`, `variant`, and `disabled`. `ActionFormFieldset` takes the props of `Fieldset`; its `disabled` closes the fields whether or not the Action is in flight.
