import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
} from "@publira/ui-components/empty-state";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { z } from "zod";

import { FollowControlSkeleton } from "#components/follow-button";
import { FollowControl } from "#components/follow-control";
import {
  ListPagination,
  ListPaginationSkeleton,
  ListPaginationStep,
} from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { PageLoadError } from "#components/page-load-error";
import { Prose } from "#components/prose";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { SeriesShelf, SeriesShelfSkeleton } from "#components/series-shelf";
import { getPublishedAuthorDetail } from "#lib/authors";
import type { PublishedAuthorDetail } from "#lib/authors";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import {
  authorDetailHref,
  parseAuthorDetailSearchParams,
} from "./_lib/search-params";

const AUTHOR_SERIES_PAGE_SIZE = 20;

/** The author's portrait, at the size the page draws it. */
const AUTHOR_ICON_SIZE = 96;

type AuthorDetailPageProps =
  PageProps<"/[tenant_id]/[locale]/authors/[author_id]">;

const authorDetailParamsSchema = z.object({
  author_id: routeParamString(),
});

/**
 * `"use cache"` keys on the serialized arguments, so metadata and the page
 * body have to pass the same `{ limit, token }` or one request fills two
 * entries and hits the RPC twice.
 */
const loadPublishedAuthorDetail = (
  tenantId: string,
  authorId: string,
  locale: Locale,
  token: string
) =>
  getPublishedAuthorDetail(tenantId, authorId, {
    limit: AUTHOR_SERIES_PAGE_SIZE,
    locale,
    token,
  });

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "author_id");

export const generateMetadata = async ({
  params,
  searchParams,
}: AuthorDetailPageProps): Promise<Metadata> => {
  const [rawParams, tenantId, resolvedSearchParams, locale] = await Promise.all(
    [params, getTenantId(), searchParams, getLocale()]
  );
  const parsedParams = parseRouteParams(authorDetailParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { author_id } = parsedParams;

  const { token } = parseAuthorDetailSearchParams(resolvedSearchParams);

  const [result, messages] = await Promise.all([
    loadPublishedAuthorDetail(tenantId, author_id, locale, token),
    loadHostMessages(locale),
  ]);

  // An unavailable author reads as "not found" for the `<title>` alone; the
  // page body below says what actually happened.
  const author = result.ok ? result.value : null;

  if (!author) {
    return {
      title: getMessage(messages, "host.authors.not_found_title"),
    };
  }

  return {
    description:
      author.profileText ||
      getMessage(messages, "host.authors.detail_description", {
        count: author.seriesCount,
        name: author.name,
      }),
    title: author.name,
  };
};

const AuthorDetailSkeleton = () => (
  <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
    <div className="grid gap-4">
      <div className="flex items-start gap-5">
        <Skeleton className="size-24 shrink-0 rounded-surface" />
        <div className="grid flex-1 gap-2">
          <SkeletonLine className="h-8 w-1/2" />
          <SkeletonLine className="h-4 w-40" />
        </div>
      </div>
      <Skeleton className="h-16 w-full max-w-(--measure-prose)" />
    </div>
    <SeriesShelfSkeleton />
  </div>
);

/**
 * The author's portrait. `alt` is an attribute rather than a node, so this is
 * the one piece of the header that has to wait for the catalog; it waits
 * behind a boundary of its own so the name beside it does not.
 */
const AuthorIcon = async ({ name, url }: { name: string; url: string }) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <Image
      alt={getMessage(messages, "host.authors.icon_alt", { name })}
      className="size-24 shrink-0 rounded-surface object-cover"
      decoding="async"
      height={AUTHOR_ICON_SIZE}
      src={url}
      width={AUTHOR_ICON_SIZE}
    />
  );
};

/**
 * The pagination's `<nav>`, and the one component on this screen that resolves
 * the catalog for a string: an `aria-label` cannot be a node. The key stays
 * written out here, beside the `getMessage` that reads it.
 */
const AuthorSeriesPaginationNav = async ({
  children,
}: {
  children: ReactNode;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <ListPagination
      aria-label={getMessage(messages, "host.authors.series_pagination_aria")}
    >
      {children}
    </ListPagination>
  );
};

const AuthorSeriesPagination = ({
  authorId,
  nextToken,
  previousToken,
}: {
  authorId: string;
  nextToken: string;
  previousToken: string;
}) => (
  <Suspense fallback={<ListPaginationSkeleton />}>
    <AuthorSeriesPaginationNav>
      <ListPaginationStep
        href={previousToken ? authorDetailHref(authorId, previousToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep
        href={nextToken ? authorDetailHref(authorId, nextToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.next_page" />
        </Suspense>
      </ListPaginationStep>
    </AuthorSeriesPaginationNav>
  </Suspense>
);

const AuthorRelatedSeries = async ({
  author,
  token,
}: {
  author: PublishedAuthorDetail;
  token: string;
}) => {
  const locale = await getLocale();

  if (author.series.length === 0) {
    if (!token) {
      return (
        <EmptyState>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.authors.series_empty" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
      );
    }

    // The covers this page pointed at are gone. The server hands back a token
    // for the neighbouring page when it can, and empty tokens when it cannot —
    // then the only way out is the first page (`proto/README.md`).
    return (
      <div className="grid gap-8">
        <EmptyState>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.series.page_empty" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
        {author.previousToken || author.nextToken ? (
          <AuthorSeriesPagination
            authorId={author.id}
            nextToken={author.nextToken}
            previousToken={author.previousToken}
          />
        ) : (
          <p>
            <LocaleLink
              className="text-sm text-primary underline underline-offset-4"
              href={authorDetailHref(author.id, "")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="host.authors.series_first_page" />
              </Suspense>
            </LocaleLink>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <SeriesShelf locale={locale} series={author.series} />
      <AuthorSeriesPagination
        authorId={author.id}
        nextToken={author.nextToken}
        previousToken={author.previousToken}
      />
    </div>
  );
};

const AuthorDetailContent = async ({
  params,
  searchParams,
}: AuthorDetailPageProps) => {
  const [rawParams, tenantId, resolvedSearchParams, locale] = await Promise.all(
    [params, getTenantId(), searchParams, getLocale()]
  );
  const parsedParams = parseRouteParams(authorDetailParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { author_id } = parsedParams;

  const { token } = parseAuthorDetailSearchParams(resolvedSearchParams);

  // A failed read is a value, not a throw: a `"use cache"` fill that throws
  // fails the whole request, so neither this page nor any boundary would get
  // to render anything.
  const result = await loadPublishedAuthorDetail(
    tenantId,
    author_id,
    locale,
    token
  );

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  const author = result.value;

  if (!author) {
    notFound();
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
      <div className="grid gap-4">
        <div className="flex items-start gap-5">
          {author.iconImageUrl && (
            <Suspense
              fallback={
                <Skeleton className="size-24 shrink-0 rounded-surface" />
              }
            >
              <AuthorIcon name={author.name} url={author.iconImageUrl} />
            </Suspense>
          )}
          <div className="grid min-w-0 flex-1 gap-2">
            <h1 className="font-serif text-3xl leading-tight">{author.name}</h1>
            <p className="text-sm text-muted-foreground tabular-nums">
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message
                  message="host.common.series_count"
                  values={{ count: author.seriesCount }}
                />
              </Suspense>
            </p>
          </div>
        </div>

        {author.profileText ? (
          <Prose locale={locale}>{author.profileText}</Prose>
        ) : (
          <p className="text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="host.authors.profile_empty" />
            </Suspense>
          </p>
        )}

        <div>
          <SectionErrorBoundary
            title={
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="host.follow.control_error" />
              </Suspense>
            }
          >
            <Suspense fallback={<FollowControlSkeleton />}>
              <FollowControl
                publicId={author.id}
                returnTo={`/authors/${author.id}`}
                targetKind="author"
                targetName={author.name}
                tenantId={tenantId}
              />
            </Suspense>
          </SectionErrorBoundary>
        </div>
      </div>

      <section className="grid gap-4">
        <div className="grid gap-1 border-b border-border pb-2">
          <h2 className="font-serif text-xl leading-tight">
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="host.authors.series_heading" />
            </Suspense>
          </h2>
          <p className="text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.authors.series_description" />
            </Suspense>
          </p>
        </div>

        <Suspense fallback={<SeriesShelfSkeleton />}>
          <AuthorRelatedSeries author={author} token={token} />
        </Suspense>
      </section>

      <p>
        <LocaleLink
          className="text-sm text-primary underline underline-offset-4"
          href="/authors"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="host.authors.back_to_list" />
          </Suspense>
        </LocaleLink>
      </p>
    </main>
  );
};

const Page = (props: AuthorDetailPageProps) => (
  <Suspense fallback={<AuthorDetailSkeleton />}>
    <AuthorDetailContent {...props} />
  </Suspense>
);

export default Page;
