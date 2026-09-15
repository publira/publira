# layouts

The package that provides the layout components reused across several web apps.

## What it provides

- `SiteLayout` and its parts — `SiteLayoutHeader`, `SiteLayoutBrand`, `SiteLayoutMain`, `SiteLayoutFooter`, `SiteLayoutFooterContent`, `SiteLayoutFooterNote`
- `@publira/layouts/auth-screen`: `AuthScreen` and its parts — `AuthScreenMain`, `AuthScreenPanel`, `AuthScreenPattern`, `AuthScreenHeader`, `AuthScreenTitle`, `AuthScreenTagline`, `AuthScreenBody`, `AuthScreenText`, `AuthScreenNote`, `AuthScreenFooter`. The split the sign-in, sign-up, password, verification, and invitation screens of all three apps are laid out in: the form in `AuthScreenMain`, and from `lg` up a second half in `AuthScreenPanel`, which `AuthScreenPattern` fills with fixed geometry
- `styles.css`

## Usage

```css
@import "@publira/layouts/styles.css";
```

```tsx
import {
  SiteLayout,
  SiteLayoutBrand,
  SiteLayoutFooter,
  SiteLayoutFooterContent,
  SiteLayoutFooterNote,
  SiteLayoutHeader,
  SiteLayoutMain,
} from "@publira/layouts";

export default function Page() {
  return (
    <SiteLayout>
      <SiteLayoutHeader>
        <SiteLayoutBrand href="/">Publira</SiteLayoutBrand>
      </SiteLayoutHeader>
      <SiteLayoutMain>content</SiteLayoutMain>
      <SiteLayoutFooter>
        <SiteLayoutFooterContent>
          <SiteLayoutFooterNote>Crafted for calm reading.</SiteLayoutFooterNote>
        </SiteLayoutFooterContent>
      </SiteLayoutFooter>
    </SiteLayout>
  );
}
```

## Build

```bash
pnpm build --filter @publira/layouts
```
