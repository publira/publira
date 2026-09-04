# SectionError

A component that shows that one section of a page failed to load. What is shown when the whole page fails is the job of each app's `ErrorScreen` (`error.tsx`).

## Usage

```tsx
import { SectionError } from "@publira/ui-components";

export default function Example() {
  return (
    <SectionError
      description="You do not have permission to perform this action."
      title="Could not display the operators"
    />
  );
}
```

## sectionErrorFallback

The fallback to pass to `catchError` from `next/error`. It renders a `SectionError` with a retry button and the `error.digest`. `SectionError` takes that digest as `{ label, value }`, so a digest can never reach the screen without the label that introduces it — this package holds no copy of its own to fall back on. The `catchError` call itself belongs in each app's `components/section-error-catch.tsx`, and what a screen uses is the `components/section-error-boundary.tsx` that wraps it and resolves the guidance text, the retry button label, and the error ID label from the catalog.

```tsx
"use client";

import { sectionErrorFallback } from "@publira/ui-components/section-error";
import { catchError } from "next/error";

export const SectionErrorCatch = catchError(sectionErrorFallback);
```

Place it outside the `<Suspense>`, so the section's skeleton comes back while the retry runs.

```tsx
<SectionErrorBoundary title="Could not display the recommendations">
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
