# brand

The package that provides Publira's brand tokens.

## What it provides

- `theme.css`: the color and typography tokens used from Tailwind v4's `@theme`, and `.publira-theme-scope`, which re-derives the color tokens on one element so a subtree can be painted from a `--publira-color-*` set other than the document's

The typography tokens:

| Token | Value | Utility |
| --- | --- | --- |
| `--font-serif` | `--publira-font-serif`, falling back to the Mincho stack | `font-serif` |
| `--font-sans` | `--publira-font-sans`, falling back to the Gothic stack | `font-sans` |
| `--text-xs` … `--text-3xl` | 12, 14, 16, 19, 23, 28, 34, 41px, written in `rem` | `text-xs` … `text-3xl` |
| `--leading-ui` / `--leading-heading` | 1.5 / 1.25, already carried by the size tokens | `leading-ui` / `leading-heading` |
| `--leading-reading-cjk` / `--leading-reading-latin` | 1.9 / 1.6 | `leading-reading-cjk` / `leading-reading-latin` |
| `--measure-prose` | `40rem` | `max-w-(--measure-prose)` |

No font file is served: both stacks name faces the reader's platform already has.

## Usage

```css
@import "@publira/brand/theme.css";
```

The per-tenant dynamic theme comes from a short-TTL `GET /theme.css` (`app/[tenant_id]/theme.css/route.ts`) that returns the `--publira-color-*` values, loaded by the root layout through `<link rel="stylesheet" href="/theme.css" />`.

## Notes

- A token name reaches every screen, so check `ui-components` and all three web apps together when you change one.
- Prefer a token over a hard-coded color.
