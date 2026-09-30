# brand

The package that provides Publira's brand tokens and its mark.

## What it provides

- `logo-mark/*.png`: the Publira mark's icons, described below
- `theme.css`: the color and typography tokens used from Tailwind v4's `@theme`, and `.publira-theme-scope`, which re-derives the color tokens on one element so a subtree can be painted from a `--publira-color-*` set other than the document's

The typography tokens:

| Token | Value | Utility |
| --- | --- | --- |
| `--font-serif` | `--publira-font-serif`, falling back to the Mincho stack | `font-serif` |
| `--font-sans` | `--publira-font-sans`, falling back to the Gothic stack | `font-sans` |
| `--leading-reading-cjk` / `--leading-reading-latin` | 1.9 / 1.6 | `leading-reading-cjk` / `leading-reading-latin` |
| `--max-width-measure-prose` | `40rem` | `max-w-measure-prose` |

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

The provisional Publira mark, a stand-in until the commissioned logo (#3406) replaces it:

| Export | Size | Corners | Consumer |
| --- | --- | --- | --- |
| `@publira/brand/logo-mark/icon-32.png` | 32x32 | Rounded, transparent | `web-platform` favicon |
| `@publira/brand/logo-mark/icon-192.png` | 192x192 | Rounded, transparent | `web-platform` favicon |
| `@publira/brand/logo-mark/apple-icon-180.png` | 180x180 | Square, filled with Sumi; iOS rounds them itself | `web-platform` apple icon |

The mark is ぱ in paper (`#F5F5F2`) on a Sumi (`#1F1D1A`) tile with rounded corners, and never takes Shu. The PNGs are rendered by `task images:gen` from `assets/brand/logo-mark.svg`, which `task images:logo-mark` generates; see [`assets/README.md`](../../assets/README.md). Import them rather than copying them, so that replacing the mark here is the whole change.

The storefront and the tenant console carry the tenant's branding and do not use the mark.

## Usage

```css
@import "@publira/brand/theme.css";
```

The per-tenant dynamic theme comes from a short-TTL `GET /theme.css` (`app/[tenant_id]/theme.css/route.ts`) that returns the `--publira-color-*` values and, when configured, `--publira-font-serif` / `--publira-font-sans` values. The root layout loads it through `<link rel="stylesheet" href="/theme.css" />`.

## Notes

- A token name reaches every screen, so check `ui-components` and all three web apps together when you change one.
- Prefer a token over a hard-coded color.
