# SectionError

A component that shows that one section of a page failed to load. What is shown when the whole page fails is the job of each app's `ErrorScreen` (`error.tsx`).

## Usage

```tsx
import { SectionError } from "@publira/ui-components";

export default function Example() {
  return (
    <SectionError
      description="この操作を行う権限がありません。"
      title="オペレーター一覧を表示できませんでした"
    />
  );
}
```

## sectionErrorFallback

The fallback to pass to `catchError` from `next/error`. It renders a `SectionError` with a retry button and the `error.digest`. The `catchError` call belongs in each app's `components/section-error-catch.tsx` (this package's build strips `"use client"`, so exporting the boundary from here would have it evaluated in the server graph). What an app uses is `components/section-error-boundary.tsx`, which wraps it; being a Server Component, it resolves the guidance text, the retry button label, and the error ID label from the catalog itself.

```tsx
"use client";

import { sectionErrorFallback } from "@publira/ui-components/section-error";
import { catchError } from "next/error";

export const SectionErrorCatch = catchError(sectionErrorFallback);
```

Place it outside the `<Suspense>`. While the retry runs, that section's skeleton comes back.

```tsx
<SectionErrorBoundary title="おすすめ作品を表示できませんでした">
  <Suspense fallback={<CardGridSkeleton />}>
    <RecommendedSeriesSection />
  </Suspense>
</SectionErrorBoundary>
```

## Subpath import

```tsx
import { SectionError } from "@publira/ui-components/section-error";
```

## Props

See the implementation for the props of the SectionError component.
