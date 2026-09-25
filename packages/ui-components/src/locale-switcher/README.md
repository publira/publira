# LocaleSwitcher

The display-language control a header offers: an icon that opens a popover listing the languages, each written in its own language.

The app owns where the locale is persisted and what the languages are called; the component owns the keyboard-accessible popover and updates `<html lang>` only after the app's persistence Action has succeeded. It is composed rather than prop-driven, so each language name is written on the button that offers it and the accessible name of the icon trigger is an ordinary `aria-label`.

## Usage

```tsx
"use client";

import {
  LocaleSwitcher,
  LocaleSwitcherContent,
  LocaleSwitcherOption,
  LocaleSwitcherOptions,
  LocaleSwitcherTitle,
  LocaleSwitcherTrigger,
} from "@publira/ui-components";

export const HeaderLocaleSwitcher = ({ locale }: { locale: string }) => (
  <LocaleSwitcher
    action={setLocaleAction}
    currentLocale={locale}
    fieldName="locale"
  >
    <LocaleSwitcherTrigger aria-label="Language" />
    <LocaleSwitcherContent>
      <LocaleSwitcherTitle>Language</LocaleSwitcherTitle>
      <LocaleSwitcherOptions aria-label="Language">
        <LocaleSwitcherOption locale="en">English</LocaleSwitcherOption>
        <LocaleSwitcherOption locale="ja">日本語</LocaleSwitcherOption>
      </LocaleSwitcherOptions>
    </LocaleSwitcherContent>
  </LocaleSwitcher>
);
```

`LocaleSwitcherOptions` is a form whose `action` is the one `LocaleSwitcher` was given, and each `LocaleSwitcherOption` is a submit button carrying its `locale` under `fieldName`, so the Action reads the chosen language with `formData.get(fieldName)`. The current option is marked with `aria-current`, and each option carries `lang` so a screen reader pronounces the language's name in that language.

## Subpath import

```tsx
import { LocaleSwitcher } from "@publira/ui-components/locale-switcher";
```

## Props

- `LocaleSwitcher`: `action`, the Server Action that persists the chosen locale and receives the form's `FormData`; `currentLocale`; and `fieldName`, the form field the chosen locale is sent under.
- `LocaleSwitcherTrigger`: `aria-label`, which names the control, because the trigger is an icon on its own.
- `LocaleSwitcherOptions`: `aria-label`, which names the list of languages for a screen reader.
- `LocaleSwitcherOption`: `locale`, the value the option submits; its `children` is the language's own name.

`LocaleSwitcherContent` and `LocaleSwitcherTitle` take `children` only.
