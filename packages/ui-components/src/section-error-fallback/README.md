# SectionErrorCatch

A section-level error boundary built on `catchError` from `next/error`, plus the two slots that need what it caught.

Once `children` throw, it renders the `fallback` tree the app gives it and supplies that tree with the two things only the boundary knows: the callback `SectionErrorCatch.Retry` runs, and the `error.digest` `SectionErrorCatch.Digest` shows. The digest line renders nothing when the error carries none, so a reader never meets a prefix with no identifier after it.

## Usage

```tsx
<SectionErrorCatch.Root
  fallback={
    <SectionError.Root>
      <SectionError.Heading>
        <SectionError.Title>{title}</SectionError.Title>
        <SectionError.Description>
          Try again in a moment.
        </SectionError.Description>
      </SectionError.Heading>
      <SectionError.Actions>
        <SectionErrorCatch.Retry>Try again</SectionErrorCatch.Retry>
      </SectionError.Actions>
      <SectionErrorCatch.Digest>Error ID:</SectionErrorCatch.Digest>
    </SectionError.Root>
  }
>
  {children}
</SectionErrorCatch.Root>
```

The body is a `fallback` prop rather than `children` because `children` is the subtree the boundary protects.

Place the boundary outside the `<Suspense>`, so the section's skeleton comes back while the retry runs. `SectionErrorBoundary` here is web-storefront's wrapper (`components/section-error-boundary.tsx`), which fills the `fallback` above from its own catalog and takes only the `title` of the section from the caller.

```tsx
<SectionErrorBoundary title="Could not display the recommendations">
  <Suspense fallback={<CardGridSkeleton />}>
    <RecommendedSeriesSection />
  </Suspense>
</SectionErrorBoundary>
```

## Subpath import

```tsx
import * as SectionErrorCatch from "@publira/ui-components/section-error-fallback";
```
