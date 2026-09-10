import { getMessage } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listPublishedAuthors } from "#lib/authors";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  authorsListHref,
  parseAuthorsListSearchParams,
} from "./_lib/search-params";

const AUTHORS_PAGE_SIZE = 12;

/** Enough rows to fill a phone screen while the read comes back. */
const AUTHORS_SKELETON_COUNT = 8;

/** The one style both pagination directions and the first-page link share. */
const paginationLinkClassName =
  "text-sm text-primary underline underline-offset-4";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.authors.list_title") };
};

const AuthorRowsSkeleton = () => (
  <div className="divide-y divide-border border-t border-border">
    {Array.from({ length: AUTHORS_SKELETON_COUNT }, (_, index) => (
      <div
        className="flex items-baseline justify-between gap-4 py-3"
        key={index}
      >
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
    ))}
  </div>
);

/**
 * The tenant's name sits inside the sentence, and the two locales put it in
 * different places, so the whole line resolves at once rather than streaming
 * the name into a fixed frame.
 */
const AuthorsListDescription = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [siteLabel, messages] = await Promise.all([
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);

  return getMessage(messages, "host.authors.list_description", {
    site: siteLabel,
  });
};

/**
 * The pagination's own `<nav>`.
 *
 * `aria-label` cannot be a node, so this resolves the catalog for that one
 * attribute and nothing else. The words inside are the caller's, each behind a
 * boundary of its own, so the navigation is the largest thing one missing
 * string can hold up.
 */
const AuthorsPaginationNav = async ({ children }: { children: ReactNode }) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <nav
      aria-label={getMessage(messages, "host.authors.pagination_aria")}
      className="flex items-baseline gap-6 border-t border-border pt-4"
    >
      {children}
    </nav>
  );
};

const AuthorsPaginationSkeleton = () => (
  <div className="flex items-baseline gap-6 border-t border-border pt-4">
    <SkeletonLine className="h-4 w-24" />
    <SkeletonLine className="h-4 w-16" />
  </div>
);

/**
 * A cursor list has no page numbers to set in ink, so the two directions are
 * all there is to render: the one that leads somewhere is an Ai text link, and
 * the end of the list is the same words without one.
 */
const AuthorsPagination = ({
  nextToken,
  previousToken,
}: {
  nextToken: string;
  previousToken: string;
}) => (
  <Suspense fallback={<AuthorsPaginationSkeleton />}>
    <AuthorsPaginationNav>
      {previousToken ? (
        <LocaleLink
          className={paginationLinkClassName}
          href={authorsListHref(previousToken)}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="host.common.previous_page" />
          </Suspense>
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="host.common.previous_page" />
          </Suspense>
        </span>
      )}

      {nextToken ? (
        <LocaleLink
          className={paginationLinkClassName}
          href={authorsListHref(nextToken)}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="host.common.next_page" />
          </Suspense>
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="host.common.next_page" />
          </Suspense>
        </span>
      )}
    </AuthorsPaginationNav>
  </Suspense>
);

const AuthorsListData = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/[locale]/authors">["searchParams"];
}) => {
  const [resolvedSearchParams, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);
  const { token } = parseAuthorsListSearchParams(resolvedSearchParams);

  const result = await listPublishedAuthors(tenantId, {
    limit: AUTHORS_PAGE_SIZE,
    locale,
    token,
  });

  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.authors.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  const { authors, nextToken, previousToken } = result.value;

  if (authors.length === 0) {
    if (!token) {
      return (
        <EmptyState>
          <EmptyStateHeading>
            <EmptyStateTitle>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="host.authors.list_empty_title" />
              </Suspense>
            </EmptyStateTitle>
            <EmptyStateDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="host.authors.list_empty_description" />
              </Suspense>
            </EmptyStateDescription>
          </EmptyStateHeading>
        </EmptyState>
      );
    }

    // The rows this page pointed at are gone. The server hands back a token for
    // the neighbouring page when it can, and empty tokens when it cannot — then
    // the only way out is the first page (`proto/README.md`).
    return (
      <div className="grid gap-8">
        <EmptyState>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.authors.page_empty" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
        {previousToken || nextToken ? (
          <AuthorsPagination
            nextToken={nextToken}
            previousToken={previousToken}
          />
        ) : (
          <p>
            <LocaleLink
              className={paginationLinkClassName}
              href={authorsListHref("")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="host.authors.first_page" />
              </Suspense>
            </LocaleLink>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <ul className="divide-y divide-border border-t border-border">
        {authors.map((author) => (
          <li key={author.id}>
            <LocaleLink
              className="group flex items-baseline justify-between gap-4 py-3"
              href={`/authors/${author.id}`}
            >
              <span className="truncate underline-offset-4 group-hover:underline">
                {author.name}
              </span>
              <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message
                    message="host.common.series_count"
                    values={{ count: author.seriesCount }}
                  />
                </Suspense>
              </span>
            </LocaleLink>
          </li>
        ))}
      </ul>

      <AuthorsPagination nextToken={nextToken} previousToken={previousToken} />
    </div>
  );
};

const AuthorsPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/authors">) => (
  <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
    <div className="grid gap-2">
      <h1 className="font-serif text-3xl leading-tight">
        <Suspense fallback={<SkeletonLine className="h-8 w-32" />}>
          <Message message="host.authors.list_title" />
        </Suspense>
      </h1>
      <p className="text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-5 w-80" />}>
          <AuthorsListDescription />
        </Suspense>
      </p>
    </div>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="host.authors.list_error" />
        </Suspense>
      }
    >
      <Suspense fallback={<AuthorRowsSkeleton />}>
        <AuthorsListData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </main>
);

export default AuthorsPage;
