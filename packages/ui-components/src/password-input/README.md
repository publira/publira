# PasswordInput

A password input with a control beside it that shows the typed value and masks it again, so a mistyped password is caught before the form is sent.

## Usage

```tsx
import {
  PasswordInput,
  PasswordInputControl,
  PasswordInputToggle,
} from "@publira/ui-components";

export default function Example() {
  return (
    <PasswordInput>
      <PasswordInputControl
        autoComplete="new-password"
        name="password"
        required
      />
      <PasswordInputToggle>Show password</PasswordInputToggle>
    </PasswordInput>
  );
}
```

## Subpath import

```tsx
import {
  PasswordInput,
  PasswordInputControl,
  PasswordInputToggle,
} from "@publira/ui-components/password-input";
```

## Props

`PasswordInput` takes the props of a `<div>` and holds whether the value is shown. `PasswordInputControl` takes the props of [Input](../input) except `type`, which the toggle owns. `PasswordInputToggle`'s `children` are its accessible name, read by assistive technology only: the control shows an eye, and `aria-pressed` reports whether the password is currently shown, so the name stays "Show password" in both states.

Each field starts masked and is masked again when its form is submitted.
