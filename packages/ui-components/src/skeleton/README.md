# Skeleton

The components used to show a loading state.

## Usage

```tsx
import { Skeleton, SkeletonCard, SkeletonText } from "@publira/ui-components";

export default function Example() {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-5 w-48" />
      <SkeletonText lines={3} />
      <SkeletonCard />
    </div>
  );
}
```

### Use `SkeletonLine` inline

`Skeleton` is a `<div>`, so dropping it into a heading or a row of buttons breaks the inline flow. Use the `<span>`-based `SkeletonLine` when the `<Suspense>` fallback sits where a heading or an action goes.

```tsx
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

<AdminPageTitle>
  <Suspense fallback={<SkeletonLine className="h-7 w-64" />}>
    <EditLabelTitle searchParams={searchParams} />
  </Suspense>
</AdminPageTitle>;
```

## Subpath import

```tsx
import {
  Skeleton,
  SkeletonCard,
  SkeletonLine,
  SkeletonText,
} from "@publira/ui-components/skeleton";
```

## Props

See the implementation for the props of the Skeleton components.
