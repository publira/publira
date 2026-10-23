# PasswordInput

A password input with a control beside it that shows the typed value and masks it again, so a mistyped password is caught before the form is sent.

## Usage

```tsx
import * as PasswordInput from "@publira/ui-components/password-input";

export default function Example() {
  return (
    <PasswordInput.Root>
      <PasswordInput.Control
        autoComplete="new-password"
        name="password"
        required
      />
      <PasswordInput.Toggle>Show password</PasswordInput.Toggle>
    </PasswordInput.Root>
  );
}
```

## Subpath import

```tsx
import * as PasswordInput from "@publira/ui-components/password-input";
```

## Props

`PasswordInput.Root` takes the props of a `<div>` and holds whether the value is shown. `PasswordInput.Control` takes the props of [Input](../input) except `type`, which the toggle owns. `PasswordInput.Toggle`'s `children` are its accessible name, read by assistive technology only: the control shows an eye, and `aria-pressed` reports whether the password is currently shown, so the name stays "Show password" in both states.

Each field starts masked and is masked again when its form is submitted.
