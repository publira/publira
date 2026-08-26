"use client";

import { ClientMessage } from "#components/client-message";
import { ErrorScreen } from "#components/error-screen";

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
 * A failure in `app/layout.tsx` itself is above this boundary and still needs
 * `global-error.tsx` — tracked in #642.
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
    <ErrorScreen
      description={<ClientMessage message="platform.errors.root_description" />}
      digest={error.digest}
      digestLabel={<ClientMessage message="platform.common.error_id" />}
      retry={retry}
      retryLabel={<ClientMessage message="platform.common.retry" />}
      title={<ClientMessage message="platform.errors.root_title" />}
    />
  </main>
);

export default RootError;
