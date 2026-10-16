# comic-viewer-shell

The comic reader both `web-storefront` and `web-admin` mount: the storefront's episode reader, and the admin console's preview of an episode's pages. It is the layout around `@publira/comic-viewer` — the rail the pages turn on, the page template, the page-turn buttons, and the progress toolbar — and the plugin the pages are fetched through. What only the storefront has (the end page, the read and reading-position recorders, the wide viewer, full screen) stays in the storefront.

Like `@publira/ui-components` and `@publira/layouts`, it holds no copy: every string arrives from the caller's catalog, as a slot's `children` or as an `aria-label` on the element it names.

## What it provides

All of it from the package root.

- The root: `ViewerRoot`, which takes the pages, the resolved reading direction and spread start, and the page to open on, and fetches every page through a plugin that sends the `Accept` header image-server resizes by and decrypts a page delivered encrypted
- The rail: `ViewerRail`, holding the page template, and `useBoxHeight`, the measured height of the box the viewer fills, which the rail takes as `boxHeight` so that a box taller than it is wide shows one page at a time
- The page template: `ViewerPage`, with `ViewerPageLoading` and `ViewerPageError` (`ViewerPageErrorMessage`, `ViewerPageRetryButton`) inside it
- An episode with no pages: `ViewerEmpty`
- The toolbar: `ViewerToolbar`, `ViewerProgress` with `ViewerProgressSlider` and `ViewerPageStatus`, and `ViewerToolbarActions` for the app's own controls
- The page-turn buttons: `ViewerPageNavigation`, `ViewerPreviousPageButton`, `ViewerNextPageButton`, and the chevrons they draw, `ViewerBackwardIcon` and `ViewerForwardIcon`, for a control an app puts in their place
- `describeVisiblePages(value)`: what a `PageStatusValue` has on screen — no page, the end page, one page, or a spread — for the formatter each app words from its own catalog
- `toViewerPages(title, images, formatPageTitle)`: an episode's body images as the viewer's pages

## Colours

The shell paints with three variables the app sets on an ancestor of the viewer:

| Variable | What it paints |
| --- | --- |
| `--viewer-mat` | The ground the pages lie on, and the toolbar |
| `--viewer-ink` | The text over the mat, and the progress slider's thumb and fill |
| `--viewer-rule` | The toolbar's hairline and the slider's unfilled track |

```tsx
<div className="size-full [--viewer-ink:var(--color-background)] [--viewer-mat:var(--color-foreground)] [--viewer-rule:var(--color-muted-foreground)]">
  <ViewerRoot pages={pages} readingDirection="rtl" spreadStartIndex={1}>
    …
  </ViewerRoot>
</div>
```

## Usage

```css
@import "@publira/comic-viewer-shell/styles.css";
```

```tsx
"use client";

import type { ViewerPage as ViewerPageItem } from "@publira/comic-viewer";
import {
  useBoxHeight,
  ViewerNextPageButton,
  ViewerPage,
  ViewerPageLoading,
  ViewerPageNavigation,
  ViewerPreviousPageButton,
  ViewerRail,
  ViewerRoot,
} from "@publira/comic-viewer-shell";
import { useState } from "react";

export const Reader = ({ pages }: { pages: ViewerPageItem[] }) => {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const boxHeight = useBoxHeight(box);

  return (
    <div className="h-[78svh]" ref={setBox}>
      <ViewerRoot pages={pages} readingDirection="rtl" spreadStartIndex={1}>
        <ViewerRail boxHeight={boxHeight}>
          <ViewerPage>
            <ViewerPageLoading>Loading…</ViewerPageLoading>
          </ViewerPage>
        </ViewerRail>
        <ViewerPageNavigation aria-label="Page navigation">
          <ViewerPreviousPageButton aria-label="Previous page" />
          <ViewerNextPageButton aria-label="Next page" />
        </ViewerPageNavigation>
      </ViewerRoot>
    </div>
  );
};
```

`web-storefront`'s `episode-comic-viewer.tsx` and `web-admin`'s `episode-preview.tsx` fill every slot from their own catalogs.

## Build

```bash
pnpm build --filter @publira/comic-viewer-shell
```
