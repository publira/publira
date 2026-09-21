# OfflineNotice

The floating notice shown while the connection is gone. It reads `useOffline()` from `next/offline`, so it follows the app's `experimental.useOffline` state and needs nothing from the screen underneath it: it appears when Next.js enters its offline state and clears when a connectivity check succeeds.

It is held open in the top layer as a manual popover, so it is painted over a full-screen element as well as over the page.

Its only child is the copy, resolved by the app that mounts it.

## Mounting it

`tsdown` drops the `"use client"` directive when it bundles this package, and `useOffline()` cannot run in the server graph, so each app re-exports the component from a `"use client"` module of its own and mounts that once, in its root layout:

```tsx
"use client";

export { OfflineNotice } from "@publira/ui-components/offline-notice";
```

```tsx
<OfflineNotice>
  <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
    <Message message="host.common.offline" />
  </Suspense>
</OfflineNotice>
```

## Subpath import

It is not re-exported from the package root, so importing the root keeps `next/offline` out of every screen that does not mount the notice:

```tsx
import { OfflineNotice } from "@publira/ui-components/offline-notice";
```
