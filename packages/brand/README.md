# brand

The package that provides Publira's brand tokens.

## What it provides

- `theme.css`: the color and typography tokens used from Tailwind v4's `@theme`, and `.publira-theme-scope`, which re-derives the color tokens on one element so a subtree can be painted from a `--publira-color-*` set other than the document's

The typography tokens:

| Token | Value | Utility |
| --- | --- | --- |
| `--font-serif` | `--publira-font-serif`, falling back to the Mincho stack | `font-serif` |
| `--font-sans` | `--publira-font-sans`, falling back to the Gothic stack | `font-sans` |
| `--leading-reading-cjk` / `--leading-reading-latin` | 1.9 / 1.6 | `leading-reading-cjk` / `leading-reading-latin` |
| `--measure-prose` | `40rem` | `max-w-(--measure-prose)` |

No font file is served: both stacks name faces the reader's platform already has.

Sizes and the remaining line heights come from Tailwind: `text-xs` … `text-9xl`, `leading-tight` for a heading, `leading-normal` for UI text.

The radius and shadow tokens:

| Token | Value | Utility | Role |
| --- | --- | --- | --- |
| `--radius-control` | `0.25rem` | `rounded-control` | Inputs, buttons, chips, small thumbnails |
| `--radius-surface` | `0.5rem` | `rounded-surface` | Artwork (covers, eyecatches) and floating layers (dialog, popover, toast) |
| `--shadow-floating` | `0 8px 24px -12px rgb(31 29 26 / 0.35)` | `shadow-floating` | Floating layers, and the only shadow there is |

An in-flow surface — a card, a table — carries neither, unless it holds artwork.

The motion tokens:

| Token | Value | Utility | Role |
| --- | --- | --- | --- |
| `--transition-duration-state` | `150ms` | `duration-state` | A state change a person asked for: a dialog opening, a menu expanding, a toggle switching, a toast arriving |
| `--ease-state` | `var(--ease-out)` | `ease-state` | The curve those take |

`@publira/layouts/styles.css` drops every transition and animation under `prefers-reduced-motion: reduce`.

## Usage

```css
@import "@publira/brand/theme.css";
```

The per-tenant dynamic theme comes from a short-TTL `GET /theme.css` (`app/[tenant_id]/theme.css/route.ts`) that returns the `--publira-color-*` values and, when configured, `--publira-font-serif` / `--publira-font-sans` values. The root layout loads it through `<link rel="stylesheet" href="/theme.css" />`.

## Notes

- A token name reaches every screen, so check `ui-components` and all three web apps together when you change one.
- Prefer a token over a hard-coded color.
