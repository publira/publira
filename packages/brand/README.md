# brand

Publira のブランドトークンを提供するパッケージです。

## 提供物

- `theme.css`: Tailwind v4 の `@theme` で利用する color / font token

## 使い方

```css
@import "@publira/brand/theme.css";
```

## 注意点

- トークン名は既存 UI 互換性に影響するため、変更時は `ui-components` と各 web app をあわせて確認してください。
- ハードコード色より token の利用を優先してください。
