# SectionErrorCatch

A section-level error boundary built on `catchError` from `next/error`, plus the two slots that need what it caught.

Once `children` throw, it renders the `fallback` tree the app gives it and supplies that tree with the two things only the boundary knows: the callback `SectionErrorRetry` runs, and the `error.digest` `SectionErrorDigest` shows. The digest line renders nothing when the error carries none, so a reader never meets a prefix with no identifier after it.

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
import { SectionErrorCatch } from "@publira/ui-components/section-error-fallback";
```
