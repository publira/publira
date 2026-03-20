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
import { SiteLayout } from "@publira/layouts";

export default function Page() {
  return (
    <SiteLayout appLabel="Publira" footerNote="Crafted for calm reading.">
      <main>content</main>
    </SiteLayout>
  );
}
```

## ビルド

```bash
pnpm --filter @publira/layouts build
```
