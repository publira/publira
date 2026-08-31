# layouts

The package that provides the layout components reused across several web apps.

## What it provides

- `SiteLayout`
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
pnpm --filter @publira/layouts build
```
