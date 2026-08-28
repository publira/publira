# layouts

複数の Web アプリで再利用するレイアウトコンポーネントを提供するパッケージです。

## 提供物

- `SiteLayout`
- `styles.css`

## 使い方

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

## ビルド

```bash
pnpm --filter @publira/layouts build
```
