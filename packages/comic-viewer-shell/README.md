# comic-viewer-shell

The comic reader both `web-storefront` and `web-admin` mount: the storefront's episode reader, and the admin console's preview of an episode's pages. It is the layout around `@publira/comic-viewer` — the rail the pages turn on, the page template, the page-turn buttons, and the progress toolbar — and the plugin the pages are fetched through. What only the storefront has (the end page, the read and reading-position recorders, the wide viewer, full screen) stays in the storefront.

Like `@publira/ui-components` and `@publira/layouts`, it holds no copy: every string arrives from the caller's catalog, as a slot's `children` or as an `aria-label` on the element it names.

## What it provides

The parts are the `Viewer` namespace of `@publira/comic-viewer-shell/viewer`, imported whole as `import * as Viewer from "@publira/comic-viewer-shell/viewer"` in the form `@publira/ui-components` uses. The package root holds the helpers, as plain named exports.

From `@publira/comic-viewer-shell/viewer`:

- The root: `Viewer.Root`, which takes the pages, the resolved reading direction and spread start, and the page to open on, and fetches every page through a plugin that sends the `Accept` header image-server resizes by and decrypts a page delivered encrypted
- The rail: `Viewer.Rail`, holding the page template, which takes as `boxHeight` the height `useBoxHeight` measures, so that a box taller than it is wide shows one page at a time
- The page template: `Viewer.Page`, with `Viewer.PageLoading` and `Viewer.PageError` (`Viewer.PageErrorMessage`, `Viewer.PageRetryButton`) inside it
- An episode with no pages: `Viewer.Empty`
- The toolbar: `Viewer.Toolbar`, `Viewer.Progress` with `Viewer.ProgressSlider` and `Viewer.PageStatus`, and `Viewer.ToolbarActions` for the app's own controls
- The page-turn buttons: `Viewer.PageNavigation`, `Viewer.PreviousPageButton`, `Viewer.NextPageButton`, and the chevrons they draw, `Viewer.BackwardIcon` and `Viewer.ForwardIcon`, for a control an app puts in their place

From the package root:

- `useBoxHeight(box)`: the measured height of the box the viewer fills, for `Viewer.Rail`'s `boxHeight`
- `describeVisiblePages(value)`: what a `PageStatusValue` has on screen — no page, the end page, one page, or a spread — for the formatter each app words from its own catalog
- `renewFromPageUrls(readPageUrls)`: a `renewPageUrl` for `Viewer.Root` that answers every page refused at once from one read of all the pages' URLs, keyed by image id
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
  <Viewer.Root pages={pages} readingDirection="rtl" spreadStartIndex={1}>
    …
  </Viewer.Root>
</div>
```

## Usage

```css
@import "@publira/comic-viewer-shell/styles.css";
```

```tsx
"use client";

import type { ViewerPage } from "@publira/comic-viewer";
import { useBoxHeight } from "@publira/comic-viewer-shell";
import * as Viewer from "@publira/comic-viewer-shell/viewer";
import { useState } from "react";

export const Reader = ({ pages }: { pages: ViewerPage[] }) => {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const boxHeight = useBoxHeight(box);

  return (
    <div className="h-[78svh]" ref={setBox}>
      <Viewer.Root pages={pages} readingDirection="rtl" spreadStartIndex={1}>
        <Viewer.Rail boxHeight={boxHeight}>
          <Viewer.Page>
            <Viewer.PageLoading>Loading…</Viewer.PageLoading>
          </Viewer.Page>
        </Viewer.Rail>
        <Viewer.PageNavigation aria-label="Page navigation">
          <Viewer.PreviousPageButton aria-label="Previous page" />
          <Viewer.NextPageButton aria-label="Next page" />
        </Viewer.PageNavigation>
      </Viewer.Root>
    </div>
  );
};
```

`web-storefront`'s `episode-comic-viewer.tsx` and `web-admin`'s `episode-preview.tsx` fill every slot from their own catalogs.

## Build

```bash
pnpm build --filter @publira/comic-viewer-shell
```
