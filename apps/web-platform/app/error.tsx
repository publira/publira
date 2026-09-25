"use client";

import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { ErrorBoundaryMessage } from "#components/error-boundary-message";
import {
  ErrorScreen,
  ErrorScreenDigest,
  ErrorScreenRetry,
} from "#components/error-screen";
import {
  PlatformPageActions,
  PlatformPageDescription,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
} from "#components/platform-page";

/**
 * Error boundary for the root segment. It catches what
 * `(protected)/error.tsx` cannot:
 *
 * - failures raised while rendering `(protected)/layout.tsx` — `PlatformUser`
 *   and `getPlatformCurrentOperator()` are part of that layout's own tree, so
 *   they sit above the `(protected)` boundary;
 * - the pre-login routes (`/login`, `/setup`, `/reset-password`,
 *   `/confirm-email`, `/confirm-password`) that sit directly under `app/` with
 *   no group layout of their own.
 *
 * Because the failing layout is what supplies the sidebar and header, this
 * screen renders bare inside `app/layout.tsx`, and the pre-login routes have no
 * chrome to keep in the first place.
 *
 * A failure in `app/layout.tsx` itself is above this boundary; catching it
 * would need a `global-error.tsx`, which this app does not have.
 *
 * Sitting directly under the root layout is also why every string below has its
 * own `<Suspense>`: nothing above this boundary can absorb a suspend, and
 * `<ErrorBoundaryMessage>` suspends while it loads the catalog. Without a
 * fallback to flush, React cuts the response short after the 200 is already
 * committed and the operator gets the browser's own network-error page instead
 * of this screen.
 */
const RootError = ({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) => (
  // Neither the failing layout nor the pre-login pages get to render their own
  // landmark, so this boundary owns the `<main>` element itself.
  <main>
    <ErrorScreen digest={error.digest} retry={retry}>
      <PlatformPageHeader>
        <PlatformPageHeading>
          <PlatformPageTitle>
            <Suspense fallback={<SkeletonLine className="h-8 w-96" />}>
              <ErrorBoundaryMessage message="platform.errors.root_title" />
            </Suspense>
          </PlatformPageTitle>
          <PlatformPageDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
              <ErrorBoundaryMessage message="platform.errors.root_description" />
            </Suspense>
          </PlatformPageDescription>
        </PlatformPageHeading>
        <PlatformPageActions>
          <ErrorScreenRetry>
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <ErrorBoundaryMessage message="platform.common.retry" />
            </Suspense>
          </ErrorScreenRetry>
        </PlatformPageActions>
      </PlatformPageHeader>
      <ErrorScreenDigest>
        <Suspense fallback={<SkeletonLine className="h-3 w-16" />}>
          <ErrorBoundaryMessage message="platform.common.error_id" />
        </Suspense>
      </ErrorScreenDigest>
    </ErrorScreen>
  </main>
);

export default RootError;
