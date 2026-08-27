import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";

/**
 * 404 for everything under the tenant site. `getTenantId()` /
 * `guardPlaceholders()` and the catalog / author / published-page routes all
 * reach here through `notFound()`, so the copy stays resource-agnostic.
 *
 * Rendered inside `(site)/layout.tsx`, which keeps the tenant header and
 * footer. URLs that match no route at all are handled by
 * `app/global-not-found.tsx`, not this boundary.
 *
 * No `<main>` here: `SiteLayoutMain` already provides one.
 *
 * Known limitation, pre-existing and not introduced by this file: because the
 * root layout sits under a top-level dynamic segment, Next.js answers a
 * `notFound()` with its `__next_error__` document — status 404 and the right
 * flight payload, but an empty SSR `<body>`, so this UI paints only after
 * hydration. `/authors/[author_id]` already behaved this way before there was
 * any `not-found.tsx`. Truly unmatched URLs use `global-not-found` instead and
 * render a full HTML document without this shell.
 */
const NotFound = () => (
  <div className="mx-auto flex max-w-3xl flex-col items-center px-6 py-24 text-center">
    <p className="text-sm tracking-wide text-muted-foreground uppercase">
      404 Not Found
    </p>
    <h1 className="mt-4 font-serif text-4xl font-bold">
      <Suspense fallback={<SkeletonLine className="h-9 w-72" />}>
        <Message message="host.errors.not_found_title" />
      </Suspense>
    </h1>
    <p className="mt-4 text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-5 w-full max-w-md" />}>
        <Message message="host.errors.not_found_description" />
      </Suspense>
    </p>
    <div className="mt-8 flex flex-wrap justify-center gap-3">
      <LocaleLink
        className="rounded-full bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:opacity-90"
        href="/"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.back_to_top" />
        </Suspense>
      </LocaleLink>
      <LocaleLink
        className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
        href="/series"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.top.to_series" />
        </Suspense>
      </LocaleLink>
    </div>
  </div>
);

export default NotFound;
