# OfflineNotice

The floating notice shown while the connection is gone. It reads `useOffline()` from `next/offline`, so it follows the app's `experimental.useOffline` state and needs nothing from the screen underneath it: it appears when Next.js enters its offline state and clears when a connectivity check succeeds.

It is held open in the top layer as a manual popover, so it is painted over a full-screen element as well as over the page.

Its only child is the copy, resolved by the app that mounts it.

## Mounting it

Each app mounts it once, in its root layout:

```tsx
<OfflineNotice>
  <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
    <Message message="storefront.common.offline" />
  </Suspense>
</OfflineNotice>
```

## Subpath import

```tsx
import { OfflineNotice } from "@publira/ui-components/offline-notice";
```
