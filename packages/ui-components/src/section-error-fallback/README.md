# sectionErrorFallback

The body of a section-level error boundary: the fallback to pass to `catchError` from `next/error`, plus the two slots that need what the boundary caught.

It renders the `fallback` tree the app gives it and supplies that tree with the two things only the boundary knows: the callback `SectionErrorRetry` runs, and the `error.digest` `SectionErrorDigest` shows. The digest line renders nothing when the error carries none, so a reader never meets a prefix with no identifier after it.

## Why this is a subpath of its own

The two slots read the caught error through a React context, and `tsdown` drops the `"use client"` directive when it bundles this package. Bundled together with [`section-error`](../section-error), that `createContext` would land in the same chunk as the presentational `SectionError` — and every Server Component that renders one would fail the build. Keeping the boundary body in its own entry keeps the presentational parts usable from the server graph.

For the same reason the `catchError` call stays in each app, in a `"use client"` module that also re-exports the two slots:

```tsx
"use client";

import { sectionErrorFallback } from "@publira/ui-components/section-error-fallback";
import { catchError } from "next/error";

export const SectionErrorCatch = catchError(sectionErrorFallback);

export {
  SectionErrorDigest,
  SectionErrorRetry,
} from "@publira/ui-components/section-error-fallback";
```

## Usage

```tsx
<SectionErrorCatch
  fallback={
    <SectionError>
      <SectionErrorHeading>
        <SectionErrorTitle>{title}</SectionErrorTitle>
        <SectionErrorDescription>
          Try again in a moment.
        </SectionErrorDescription>
      </SectionErrorHeading>
      <SectionErrorActions>
        <SectionErrorRetry>Try again</SectionErrorRetry>
      </SectionErrorActions>
      <SectionErrorDigest>Error ID:</SectionErrorDigest>
    </SectionError>
  }
>
  {children}
</SectionErrorCatch>
```

The body is a `fallback` prop rather than `children` because `children` is the subtree the boundary protects.

Place the boundary outside the `<Suspense>`, so the section's skeleton comes back while the retry runs.

```tsx
<SectionErrorBoundary title="Could not display the recommendations">
  <Suspense fallback={<CardGridSkeleton />}>
    <RecommendedSeriesSection />
  </Suspense>
</SectionErrorBoundary>
```

## Subpath import

```tsx
import { sectionErrorFallback } from "@publira/ui-components/section-error-fallback";
```
