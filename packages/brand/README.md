# brand

The package that provides Publira's brand tokens.

## What it provides

- `theme.css`: the color and font tokens used from Tailwind v4's `@theme`, and `.publira-theme-scope`, which re-derives those tokens on one element so a subtree can be painted from a `--publira-color-*` set other than the document's

## Usage

```css
@import "@publira/brand/theme.css";
```

The per-tenant dynamic theme comes from a short-TTL `GET /theme.css` (`app/[tenant_id]/theme.css/route.ts`) that returns the `--publira-color-*` values, loaded by the root layout through `<link rel="stylesheet" href="/theme.css" />`.

## Notes

- A token name reaches every screen, so check `ui-components` and all three web apps together when you change one.
- Prefer a token over a hard-coded color.
