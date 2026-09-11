import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
} from "@publira/ui-components/empty-state";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  createPlaceholderStaticParams,
  guardPlaceholders,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Suspense } from "react";

import {
  ListPagination,
  ListPaginationSkeleton,
  ListPaginationStep,
} from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { PageLoadError } from "#components/page-load-error";
import {
  SeriesFilterForm,
  SeriesFilterFormSkeleton,
} from "#components/series-filter-form";
import { SeriesShelf, SeriesShelfSkeleton } from "#components/series-shelf";
import { findPublishedTagBySlug, listPublishedSeries } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import {
  isNarrowedTagSeries,
  parseTagDetailParams,
  parseTagDetailSearchParams,
  tagDetailHref,
  tagDetailPath,
} from "./_lib/search-params";
import type { TagDetailSearchParams } from "./_lib/search-params";

const TAG_SERIES_PAGE_SIZE = 24;

type TagDetailPageProps = PageProps<"/[tenant_id]/[locale]/tags/[tag_slug]">;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "tag_slug");

export const generateMetadata = async ({
  params,
}: TagDetailPageProps): Promise<Metadata> => {
  const [{ tag_slug }, tenantId, locale] = await Promise.all([
    params,
    getTenantId(),
    getLocale(),
  ]);

  guardPlaceholders({ tag_slug });

  const tagSlug = parseTagDetailParams({ tag_slug });
  const [result, messages] = await Promise.all([
    tagSlug
      ? findPublishedTagBySlug(tenantId, tagSlug, locale)
      : { ok: true as const, value: null },
    loadHostMessages(locale),
  ]);

  // An unavailable tag reads as "not found" for the `<title>` alone; the page
  // body below says what actually happened.
  const tag = result.ok ? result.value : null;

  if (!tag) {
    return { title: getMessage(messages, "host.tags.not_found_title") };
  }

  return { title: tag.name };
};

const TagDetailSkeleton = () => (
  <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
    <div className="grid gap-2">
      <SkeletonLine className="h-8 w-1/2" />
      <SkeletonLine className="h-4 w-40" />
    </div>
    <SeriesFilterFormSkeleton />
    <SeriesShelfSkeleton />
  </div>
);

/**
 * The pagination's `<nav>`, and the one component on this screen that resolves
 * the catalog: an `aria-label` cannot be a node. The key stays written out
 * here, beside the `getMessage` that reads it.
 */
const TagSeriesPaginationNav = async ({
  children,
}: {
  children: ReactNode;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <ListPagination
      aria-label={getMessage(messages, "host.tags.series_pagination_aria")}
    >
      {children}
    </ListPagination>
  );
};

const TagSeriesPagination = ({
  nextToken,
  previousToken,
  query,
  tagSlug,
}: {
  nextToken: string;
  previousToken: string;
  query: TagDetailSearchParams;
  tagSlug: string;
}) => (
  <Suspense fallback={<ListPaginationSkeleton />}>
    <TagSeriesPaginationNav>
      <ListPaginationStep
        href={
          previousToken
            ? tagDetailHref(tagSlug, { ...query, token: previousToken })
            : ""
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep
        href={
          nextToken
            ? tagDetailHref(tagSlug, { ...query, token: nextToken })
            : ""
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.next_page" />
        </Suspense>
      </ListPaginationStep>
    </TagSeriesPaginationNav>
  </Suspense>
);

const TagSeries = async ({
  locale,
  query,
  tagSlug,
  tenantId,
}: {
  locale: Locale;
  query: TagDetailSearchParams;
  tagSlug: string;
  tenantId: string;
}) => {
  const result = await listPublishedSeries(tenantId, {
    hasFreeEpisodes: query.free,
    limit: TAG_SERIES_PAGE_SIZE,
    locale,
    order: query.order,
    status: query.status || undefined,
    tagSlug,
    token: query.token,
  });

  // The series list is one section of this page, so a failed read replaces
  // that section and leaves the heading and the filters above it standing.
  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.series.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  const { nextToken, previousToken, series } = result.value;

  if (series.length === 0) {
    if (!query.token) {
      return (
        <div className="grid gap-8">
          <EmptyState>
            <EmptyStateDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                {isNarrowedTagSeries(query) ? (
                  <Message message="host.series.filter_empty" />
                ) : (
                  <Message message="host.tags.series_empty" />
                )}
              </Suspense>
            </EmptyStateDescription>
          </EmptyState>
          {isNarrowedTagSeries(query) && (
            <p>
              <LocaleLink
                className="text-sm text-primary underline underline-offset-4"
                href={tagDetailPath(tagSlug)}
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                  <Message message="host.series.filter_clear" />
                </Suspense>
              </LocaleLink>
            </p>
          )}
        </div>
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
        {previousToken || nextToken ? (
          <TagSeriesPagination
            nextToken={nextToken}
            previousToken={previousToken}
            query={query}
            tagSlug={tagSlug}
          />
        ) : (
          <p>
            <LocaleLink
              className="text-sm text-primary underline underline-offset-4"
              href={tagDetailHref(tagSlug, { ...query, token: "" })}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="host.tags.series_first_page" />
              </Suspense>
            </LocaleLink>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <SeriesShelf locale={locale} series={series} />
      <TagSeriesPagination
        nextToken={nextToken}
        previousToken={previousToken}
        query={query}
        tagSlug={tagSlug}
      />
    </div>
  );
};

const TagDetailContent = async ({
  params,
  searchParams,
}: TagDetailPageProps) => {
  const [{ tag_slug }, tenantId, resolvedSearchParams, locale] =
    await Promise.all([params, getTenantId(), searchParams, getLocale()]);

  guardPlaceholders({ tag_slug });

  const tagSlug = parseTagDetailParams({ tag_slug });
  const query = parseTagDetailSearchParams(resolvedSearchParams);

  if (!tagSlug) {
    notFound();
  }

  // A failed read is a value, not a throw: a `"use cache"` fill that throws
  // fails the whole request, so neither this page nor any boundary would get
  // to render anything.
  const result = await findPublishedTagBySlug(tenantId, tagSlug, locale);

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  const tag = result.value;

  if (!tag) {
    notFound();
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
      <div className="grid gap-2">
        <h1 className="font-serif text-3xl leading-tight">{tag.name}</h1>
        <p className="text-sm text-muted-foreground tabular-nums">
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message
              message="host.common.series_count"
              values={{ count: tag.publishedSeriesCount }}
            />
          </Suspense>
        </p>
      </div>

      <Suspense fallback={<SeriesFilterFormSkeleton />}>
        <SeriesFilterForm
          basePath={tagDetailPath(tagSlug)}
          genres={[]}
          query={query}
        />
      </Suspense>

      <Suspense fallback={<SeriesShelfSkeleton />}>
        <TagSeries
          locale={locale}
          query={query}
          tagSlug={tagSlug}
          tenantId={tenantId}
        />
      </Suspense>

      <p>
        <LocaleLink
          className="text-sm text-primary underline underline-offset-4"
          href="/series"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="host.series.back_to_list" />
          </Suspense>
        </LocaleLink>
      </p>
    </main>
  );
};

const Page = (props: TagDetailPageProps) => (
  <Suspense fallback={<TagDetailSkeleton />}>
    <TagDetailContent {...props} />
  </Suspense>
);

export default Page;
