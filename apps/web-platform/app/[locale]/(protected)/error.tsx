"use client";

import * as ConsolePage from "@publira/layouts/admin/console-page";
import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

import { ClientMessage } from "#components/client-message";
import * as ErrorScreen from "#components/error-screen";

/**
 * Error boundary for the platform console pages. It wraps the pages and nested
 * layouts under `(protected)` but not `(protected)/layout.tsx` itself, so the
 * sidebar and header keep rendering here; a failure raised while rendering that
 * layout — `PlatformUser` / `getPlatformCurrentOperator()` — falls through to
 * `app/[locale]/error.tsx`.
 *
 * ## Which boundary takes an unclassifiable RPC error
 *
 * This one, for everything a page reads. The lib layer already decides what
 * never gets this far: `rethrowUnclassifiedRpcError()` — or, for a cached read,
 * its exported caller once outside the cache scope — re-throws `internal` /
 * `unimplemented` and any non-RPC throw, while classified failures become
 * either a message the screen renders inline (`ok: false`) or a `null` the page
 * turns into `notFound()`. So the throws that land here are exactly the ones no
 * copy in `rpcErrorMessage`'s table describes, and "Please try again later."
 * with a digest is the honest answer for them.
 *
 * The two neighbours stay where they are. Failures a form can act on — invalid
 * input, conflicts — remain inline `FormMessage`s next to the control, and the
 * list screens keep rendering their `ok: false` message inside the page rather
 * than replacing it — through the shared `SectionError`, so the copy matches
 * what a boundary would show.
 *
 * `SectionErrorBoundary` also narrows this boundary's reach: a section wrapped
 * in one takes its own throws, so only a failure outside every such boundary
 * replaces the whole console page.
 *
 * No `<main>` here: `ConsoleLayout.Main` already provides one.
 *
 * The root layout places `<PlatformMessagesProvider>` above this boundary, so
 * the copy is the catalog of the `[locale]` root parameter and needs no
 * `<Suspense>`. The browser loads no catalog of its own.
 *
 * The response status stays 200 for the same reason a `notFound()` does — see
 * `not-found.tsx`.
 */
const ConsoleError = ({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) => (
  <ErrorScreen.Root digest={error.digest} retry={retry}>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <ClientMessage message="platform.errors.console_title" />
        </ConsolePage.Title>
        <ConsolePage.Description>
          <ClientMessage message="platform.errors.console_description" />
        </ConsolePage.Description>
      </ConsolePage.Heading>
      <ConsolePage.Actions>
        <ErrorScreen.Retry>
          <ClientMessage message="platform.common.retry" />
        </ErrorScreen.Retry>
        <LinkButton render={<Link href="/" />} variant="outline">
          <ClientMessage message="platform.common.back_to_dashboard" />
        </LinkButton>
      </ConsolePage.Actions>
    </ConsolePage.Header>
    <ErrorScreen.Digest>
      <ClientMessage message="platform.common.error_id" />
    </ErrorScreen.Digest>
  </ErrorScreen.Root>
);

export default ConsoleError;
