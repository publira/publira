"use client";

import * as ConsolePage from "@publira/layouts/admin/console-page";

import { ClientMessage } from "#components/client-message";
import * as ErrorScreen from "#components/error-screen";

/**
 * Error boundary for the root segment. It catches what
 * `(protected)/error.tsx` cannot:
 *
 * - failures raised while rendering `(protected)/layout.tsx` — `PlatformUser`
 *   and `getPlatformCurrentOperator()` are part of that layout's own tree, so
 *   they sit above the `(protected)` boundary;
 * - the pre-login routes (`/login`, `/setup`, `/reset-password`,
 *   `/confirm-email`, `/confirm-password`) that sit directly under `[locale]`
 *   with no group layout of their own.
 *
 * Because the failing layout is what supplies the sidebar and header, this
 * screen renders bare inside `app/[locale]/layout.tsx`, and the pre-login
 * routes have no chrome to keep in the first place.
 *
 * A failure in `app/[locale]/layout.tsx` itself is above this boundary;
 * catching it would need a `global-error.tsx`, which this app does not have.
 * That layout places `<PlatformMessagesProvider>`, so the copy here comes from
 * the same catalog as every other screen. The read depends only on the
 * `[locale]` root parameter, which is why the strings need no `<Suspense>` and
 * the browser loads no catalog of its own.
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
    <ErrorScreen.Root digest={error.digest} retry={retry}>
      <ConsolePage.Header>
        <ConsolePage.Heading>
          <ConsolePage.Title>
            <ClientMessage message="platform.errors.root_title" />
          </ConsolePage.Title>
          <ConsolePage.Description>
            <ClientMessage message="platform.errors.root_description" />
          </ConsolePage.Description>
        </ConsolePage.Heading>
        <ConsolePage.Actions>
          <ErrorScreen.Retry>
            <ClientMessage message="platform.common.retry" />
          </ErrorScreen.Retry>
        </ConsolePage.Actions>
      </ConsolePage.Header>
      <ErrorScreen.Digest>
        <ClientMessage message="platform.common.error_id" />
      </ErrorScreen.Digest>
    </ErrorScreen.Root>
  </main>
);

export default RootError;
