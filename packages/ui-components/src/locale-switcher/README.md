# LocaleSwitcher

The display-language control a header offers: an icon that opens a popover listing the languages, each written in its own language.

The app owns where the locale is persisted and what the languages are called; the component owns the keyboard-accessible popover and updates `<html lang>` only after the app's persistence Action has succeeded. It is composed rather than prop-driven, so each language name is written on the button that offers it and the accessible name of the icon trigger is an ordinary `aria-label`.

## Usage

```tsx
"use client";

import * as LocaleSwitcher from "@publira/ui-components/locale-switcher";

export const HeaderLocaleSwitcher = ({ locale }: { locale: string }) => (
  <LocaleSwitcher.Root
    action={setLocaleAction}
    currentLocale={locale}
    fieldName="locale"
  >
    <LocaleSwitcher.Trigger aria-label="Language" />
    <LocaleSwitcher.Content>
      <LocaleSwitcher.Title>Language</LocaleSwitcher.Title>
      <LocaleSwitcher.Options aria-label="Language">
        <LocaleSwitcher.Option locale="en">English</LocaleSwitcher.Option>
        <LocaleSwitcher.Option locale="ja">日本語</LocaleSwitcher.Option>
      </LocaleSwitcher.Options>
    </LocaleSwitcher.Content>
  </LocaleSwitcher.Root>
);
```

`LocaleSwitcher.Options` is a form whose `action` is the one `LocaleSwitcher.Root` was given, and each `LocaleSwitcher.Option` is a submit button carrying its `locale` under `fieldName`, so the Action reads the chosen language with `formData.get(fieldName)`. The current option is marked with `aria-current`, and each option carries `lang` so a screen reader pronounces the language's name in that language.

## Subpath import

```tsx
import * as LocaleSwitcher from "@publira/ui-components/locale-switcher";
```

## Props

- `LocaleSwitcher.Root`: `action`, the Server Action that persists the chosen locale and receives the form's `FormData`; `currentLocale`; and `fieldName`, the form field the chosen locale is sent under.
- `LocaleSwitcher.Trigger`: `aria-label`, which names the control, because the trigger is an icon on its own.
- `LocaleSwitcher.Options`: `aria-label`, which names the list of languages for a screen reader.
- `LocaleSwitcher.Option`: `locale`, the value the option submits; its `children` is the language's own name.

`LocaleSwitcher.Content` and `LocaleSwitcher.Title` take `children` only.
