# brand

Publira のブランドトークンを提供するパッケージです。

## 提供物

- `theme.css`: Tailwind v4 の `@theme` で利用する color / font token

## 使い方

```css
@import "@publira/brand/theme.css";
```

テナントごとの動的テーマは、短い TTL の `GET /theme.css`（`app/[tenant_id]/theme.css/route.ts`）が `--publira-color-*` を返し、root layout の `<link rel="stylesheet" href="/theme.css" />` で読みます。

## 注意点

- トークン名は既存 UI 互換性に影響するため、変更時は `ui-components` と各 web app をあわせて確認してください。
- ハードコード色より token の利用を優先してください。
- デフォルト値は `theme.css` と `DEFAULT_TENANT_THEME_COLORS` を同期してください。
