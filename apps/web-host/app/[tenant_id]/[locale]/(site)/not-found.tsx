import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";

/**
 * 404 for everything under the tenant site. `getTenantId()` /
 * `guardPlaceholders()` and the catalog / creator / published-page routes all
 * reach here through `notFound()`, so the copy stays resource-agnostic.
 *
 * Rendered inside `(site)/layout.tsx`, which keeps the tenant header and
 * footer. URLs that match no route at all are handled by
 * `app/global-not-found.tsx`, not this boundary.
 *
 * The screen is the heading, the explanation, and one way back: a reader who
 * asked for a page that is not there needs somewhere to go next, not a second
 * choice to make.
 *
 * No `<main>` here: `SiteLayoutMain` already provides one.
 *
 * Known limitation, pre-existing and not introduced by this file: because the
 * root layout sits under a top-level dynamic segment, Next.js answers a
 * `notFound()` with its `__next_error__` document — status 404 and the right
 * flight payload, but an empty SSR `<body>`, so this UI paints only after
 * hydration. `/creators/[creator_id]` already behaved this way before there was
 * any `not-found.tsx`. Truly unmatched URLs use `global-not-found` instead and
 * render a full HTML document without this shell.
 */
const NotFound = () => (
  <div className="mx-auto grid max-w-(--measure-prose) gap-4 px-6 py-16">
    <h1 className="font-serif text-3xl leading-tight">
      <Suspense fallback={<SkeletonLine className="h-8 w-72" />}>
        <Message message="host.errors.not_found_title" />
      </Suspense>
    </h1>
    <p className="text-foreground">
      <Suspense fallback={<SkeletonLine className="h-5 w-full max-w-md" />}>
        <Message message="host.errors.not_found_description" />
      </Suspense>
    </p>
    <div className="mt-2">
      <LinkButton render={<LocaleLink href="/" />} variant="outline">
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.back_to_top" />
        </Suspense>
      </LinkButton>
    </div>
  </div>
);

export default NotFound;
