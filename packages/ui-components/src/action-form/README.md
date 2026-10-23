# ActionForm

A form component that encapsulates `useActionState`. It gives Server Action error handling, the pending state, and success message display a single consistent shape.

The fields are reset when the Action returns `{ ok: true }` and keep what was typed when it returns `{ ok: false }`, so a refused submission is corrected rather than filled in again.

## Usage

### Node mode

Pass a ReactNode as `children`. The message the Action returns is rendered for you; the submit control is one of the children, so its wording, its classes, and its variant sit on the element itself. A success message is shown when the Action returns `{ ok: true, message }` — pass `showSuccess={false}` to hide it.

```tsx
import * as ActionForm from "@publira/ui-components/action-form";

export default function Example() {
  return (
    <ActionForm.Root action={myAction}>
      <input name="email" type="email" />
      <ActionForm.Submit className="w-full">
        <ActionForm.Idle>Save</ActionForm.Idle>
        <ActionForm.Pending>Saving...</ActionForm.Pending>
      </ActionForm.Submit>
    </ActionForm.Root>
  );
}
```

`ActionForm.Idle` and `ActionForm.Pending` render only while the form is idle and only while the submission their control started is in flight. A control whose wording does not change while submitting takes plain children instead.

A second control that sends the same fields to another Action, such as a connection test beside a save, is an `ActionForm.Submit` given that Action as `formAction`. The form keeps what it holds afterwards, the control is not the form's default button, so Enter in a field still saves, and the pending slots inside each control follow only the submission that control started.

```tsx
<ActionForm.Root action={saveAction}>
  <Field.Root>...</Field.Root>
  <ActionForm.Submit formAction={dispatchTest} variant="outline">
    <ActionForm.Idle>Test connection</ActionForm.Idle>
    <ActionForm.Pending>Testing...</ActionForm.Pending>
  </ActionForm.Submit>
  <ActionForm.Submit>Save</ActionForm.Submit>
</ActionForm.Root>
```

`ActionForm.Fieldset` is a `Fieldset` that is also closed while the Action is in flight. Wrap the fields the form submits in it; a control independent of the submission, such as one that opens an unrelated dialog, can stay outside.

```tsx
<ActionForm.Root action={myAction} className="grid gap-4">
  <ActionForm.Fieldset className="grid gap-4">
    <Field.Root>...</Field.Root>
  </ActionForm.Fieldset>
  <ActionForm.Submit>Save</ActionForm.Submit>
</ActionForm.Root>
```

### Field errors, returned data, and follow-ups

An Action can answer with more than a sentence, and each part of that answer is read by the one component that needs it, so the form itself can stay a Server Component.

A refused submission may carry `fieldErrors`, keyed by field. `ActionForm.FieldError` shows the entry under its `name` next to that field, and nothing otherwise:

```tsx
<ActionForm.Root action={saveSettings}>
  <Field.Root>
    <Field.Label>Close day</Field.Label>
    <Field.Content>
      <CloseDaySelect />
      <ActionForm.FieldError name="autoCloseDay" />
    </Field.Content>
  </Field.Root>
  <ActionForm.Submit>Save</ActionForm.Submit>
</ActionForm.Root>
```

A client component inside the form reads the state its Action returned with `ActionForm.useState`, typed by the caller, such as a control seeding itself from the settings a save confirmed:

```tsx
"use client";

const CloseDaySelect = ({ initialDay }: { initialDay: string }) => {
  const state = ActionForm.useState<RoyaltyCloseSettingsFormState>();
  const savedDay = state?.ok ? String(state.policy.autoCloseDay) : initialDay;

  return <DaySelect defaultValue={savedDay} key={savedDay} />;
};
```

What follows a submission — a toast, a dialog closing, a field emptied — goes in `ActionForm.useSettled`, which is called with what the form's own Action returned as part of the submission, rather than in an Effect watching the state. A control's own `formAction` does not call it.

```tsx
"use client";

const SavedToast = ({ title }: { title: ReactNode }) => {
  const { add } = Toast.useManager();
  ActionForm.useSettled((state) => {
    if (state?.ok) {
      add({ title, type: "success" });
    }
  });

  return null;
};
```

Each `ActionForm` holds the state of its own submissions, so a list that renders one form per row shows each answer on the row that was submitted, with no id to compare.

### Render function mode

Pass a function as `children` when you want to place the message yourself or read the state the Action returned. The state has the Action's own type, so an Action that returns more than `ok` and `message` hands the rest to the function too.

```tsx
import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";

export default function Example() {
  return (
    <ActionForm.Root action={myAction}>
      {({ isPending, state }) => (
        <>
          <input name="email" type="email" />
          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}
          <Button disabled={isPending} type="submit">
            <ActionForm.Idle>Save</ActionForm.Idle>
            <ActionForm.Pending>Saving...</ActionForm.Pending>
          </Button>
        </>
      )}
    </ActionForm.Root>
  );
}
```

### Using the types in a Server Action

```ts
"use server";

import type * as ActionForm from "@publira/ui-components/action-form";

export const myAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
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
import * as ActionForm from "@publira/ui-components/action-form";
```

A module that needs only the types, such as a Server Action, imports the namespace as a type: `import type * as ActionForm from "@publira/ui-components/action-form"`, then `ActionForm.State`, `ActionForm.Result`, and `ActionForm.FieldErrors`.

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `action` | `(prevState, formData) => Promise<State \| null>` | Required | The Server Action. `State` is `ActionForm.Result` (`{ ok, message, fieldErrors? }`) or a type that widens it, such as a save that also returns the settings it confirmed; the render function reads it back as `state` |
| `children` | `ReactNode \| (props) => ReactNode` | Required | Form content. Passing a function switches to render function mode |
| `showSuccess` | `boolean` | `true` | Show a success message when the state is `{ ok: true }`. Pass `false` to suppress it |
| `className` | `string` | — | className of the `<form>` |
| `id` | `string` | — | id of the `<form>`, for a submit control outside it to name with `form` (such as `ConfirmDialog.Action`) |

`ActionForm.Submit` takes the submit button's own `children`, `className`, `size`, `variant`, `disabled`, `aria-label` — the name of the item a row's control acts on — `aria-pressed` for a toggle, and `form` — the id of the form for a control a portal renders outside the form's DOM, which still has to sit inside the form in the React tree for `useFormStatus` to report the submission to it — and a `formAction` of `(formData: FormData) => void` to send the fields to in place of the form's Action. It is `aria-busy` while the submission it started is in flight. The pending slots read the same `formAction` in a plain `<form>` too, where it is the button's own `formAction`: a form with two Actions gives each of its two submit controls one. `ActionForm.FieldError` takes `name`, the key of `fieldErrors` it shows, and `className`. `ActionForm.useState` and `ActionForm.useSettled` throw outside an `ActionForm`. `ActionForm.Fieldset` takes the props of `Fieldset`; its `disabled` closes the fields whether or not the Action is in flight.
