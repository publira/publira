import { getMessage } from "@publira/i18n";
import { ChevronDownIcon, ChevronUpIcon } from "@publira/icons";
import { Badge } from "@publira/ui-components/badge";
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
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { cn, formatDateTime, formatList } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { AgeRatingBadge } from "#components/age-rating-badge";
import { EyeCatchPicture } from "#components/eye-catch-picture";
import type { EyeCatchVariant } from "#components/eye-catch-picture";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listRankedSeries } from "#lib/catalog";
import type { RankingPeriodName } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { rankMovement } from "./_lib/rank-movement";
import { parseRankingSearchParams, rankingHref } from "./_lib/search-params";

const RANKING_PAGE_SIZE = 20;

type RankingPageProps = PageProps<"/[tenant_id]/[locale]/ranking">;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.ranking.list_title") };
};

/**
 * The thumbnail beside a position. A series with no artwork keeps the frame,
 * so the numbers stay in one column whether or not the work has an image.
 */
const RankingArtwork = ({
  alt,
  variants,
}: {
  alt: string;
  variants: EyeCatchVariant[] | undefined;
}) =>
  variants && variants.length > 0 ? (
    <span className="block size-14 shrink-0 overflow-hidden rounded-control bg-muted">
      <EyeCatchPicture
        alt={alt}
        imgClassName="size-full object-cover"
        sizes="56px"
        variants={variants}
      />
    </span>
  ) : (
    <span className="block size-14 shrink-0 rounded-control bg-muted" />
  );

/**
 * What a position did since the period before it.
 *
 * Every state is a sentence rather than an arrow alone: an arrow says which
 * direction but not how far, and says nothing at all to a reader who cannot
 * see it. The chevrons are decoration on top of that sentence.
 */
const RankMovementMarker = ({
  previousRank,
  rank,
}: {
  previousRank: number | undefined;
  rank: number;
}) => {
  const movement = rankMovement(rank, previousRank);

  if (movement.kind === "new") {
    return (
      <Badge tone="info">
        <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
          <Message message="host.ranking.movement_new" />
        </Suspense>
      </Badge>
    );
  }

  if (movement.kind === "same") {
    return (
      <span className="text-xs text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.ranking.movement_none" />
        </Suspense>
      </span>
    );
  }

  if (movement.kind === "up") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <ChevronUpIcon aria-hidden="true" className="size-3.5" />
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message
            message="host.ranking.movement_up"
            values={{ count: movement.steps }}
          />
        </Suspense>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <ChevronDownIcon aria-hidden="true" className="size-3.5" />
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        <Message
          message="host.ranking.movement_down"
          values={{ count: movement.steps }}
        />
      </Suspense>
    </span>
  );
};

const RankingRowsSkeleton = ({ count = 10 }: { count?: number }) => (
  <div className="divide-y divide-border">
    {Array.from({ length: count }, (_, index) => (
      <div className="flex items-center gap-3 py-3 sm:gap-4" key={index}>
        <Skeleton className="h-6 w-16 shrink-0" />
        <Skeleton className="size-14 shrink-0 rounded-control" />
        <div className="flex-1">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="mt-2 h-3 w-1/3" />
        </div>
      </div>
    ))}
  </div>
);

const RankingTabsSkeleton = () => (
  <div className="flex gap-2">
    <Skeleton className="h-9 w-24 rounded-control" />
    <Skeleton className="h-9 w-24 rounded-control" />
  </div>
);

const rankingTabClassName = (isCurrent: boolean): string =>
  cn(
    "rounded-control border px-4 py-2 text-sm",
    isCurrent
      ? "border-primary bg-primary/10 text-primary"
      : "border-border text-muted-foreground hover:text-foreground"
  );

/**
 * The two charts, as links rather than as a control: which one is shown is
 * part of the address, so a reader can bookmark the weekly chart and a crawler
 * can index both.
 */
const RankingTabs = async ({
  searchParams,
}: {
  searchParams: RankingPageProps["searchParams"];
}) => {
  const [resolvedSearchParams, locale] = await Promise.all([
    searchParams,
    getLocale(),
  ]);
  const { period } = parseRankingSearchParams(resolvedSearchParams);
  const messages = await loadHostMessages(locale);

  return (
    <nav
      aria-label={getMessage(messages, "host.ranking.period_nav")}
      className="flex gap-2"
    >
      <LocaleLink
        aria-current={period === "daily" ? "page" : undefined}
        className={rankingTabClassName(period === "daily")}
        href={rankingHref("daily")}
      >
        {getMessage(messages, "host.ranking.period_daily")}
      </LocaleLink>
      <LocaleLink
        aria-current={period === "weekly" ? "page" : undefined}
        className={rankingTabClassName(period === "weekly")}
        href={rankingHref("weekly")}
      >
        {getMessage(messages, "host.ranking.period_weekly")}
      </LocaleLink>
    </nav>
  );
};

/**
 * Resolves the catalog itself rather than taking the three fixed strings as
 * props, the way the series list's pagination does: none of them can stream,
 * and the whole nav already sits inside the section's own boundary.
 */
const RankingPagination = async ({
  nextToken,
  period,
  previousToken,
}: {
  nextToken: string;
  period: RankingPeriodName;
  previousToken: string;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <nav
      aria-label={getMessage(messages, "host.ranking.pagination_aria")}
      className="mt-8 flex items-center justify-center gap-6"
    >
      {previousToken ? (
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={rankingHref(period, previousToken)}
        >
          {getMessage(messages, "host.common.previous_page")}
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">
          {getMessage(messages, "host.common.previous_page")}
        </span>
      )}

      {nextToken ? (
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={rankingHref(period, nextToken)}
        >
          {getMessage(messages, "host.common.next_page")}
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">
          {getMessage(messages, "host.common.next_page")}
        </span>
      )}
    </nav>
  );
};

const RankingList = async ({
  searchParams,
}: {
  searchParams: RankingPageProps["searchParams"];
}) => {
  const [resolvedSearchParams, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);
  const { period, token } = parseRankingSearchParams(resolvedSearchParams);

  const [result, timeZone, messages] = await Promise.all([
    listRankedSeries(tenantId, {
      limit: RANKING_PAGE_SIZE,
      locale,
      period,
      token,
    }),
    getTenantDisplayTimeZone(tenantId),
    loadHostMessages(locale),
  ]);

  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.ranking.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  const { computedAt, nextToken, previousToken, rankedSeries } = result.value;

  // No snapshot at all: the batch has not ranked this tenant yet, which the
  // empty `computedAt` is what says. A page of a chart that does exist is a
  // different answer, and gets the way back into the chart instead.
  if (!computedAt) {
    return (
      <EmptyState>
        <EmptyStateDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="host.ranking.list_empty" />
          </Suspense>
        </EmptyStateDescription>
      </EmptyState>
    );
  }

  if (rankedSeries.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="mb-4 text-muted-foreground">
          {getMessage(messages, "host.ranking.page_empty")}
        </p>
        {previousToken || nextToken ? (
          <RankingPagination
            nextToken={nextToken}
            period={period}
            previousToken={previousToken}
          />
        ) : (
          <LocaleLink
            className="text-sm text-primary underline-offset-4 hover:underline"
            href={rankingHref(period)}
          >
            {getMessage(messages, "host.ranking.first_page")}
          </LocaleLink>
        )}
      </div>
    );
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
          <Message
            message="host.ranking.computed_at"
            values={{
              datetime: formatDateTime(computedAt, {
                fallback: "",
                locale,
                timeZone,
              }),
            }}
          />
        </Suspense>
      </p>
      <ol className="mt-4 divide-y divide-border">
        {rankedSeries.map(({ previousRank, rank, series }) => (
          <li key={series.publicId}>
            <LocaleLink
              className="group flex items-center gap-3 py-3 sm:gap-4"
              href={`/series/${series.publicId}`}
            >
              {/* Wide enough for two digits: "No. 10" wrapping would put the
                  column out of line with every row above it. */}
              <span className="w-16 shrink-0 font-serif text-lg leading-tight whitespace-nowrap tabular-nums">
                <Suspense fallback={<SkeletonLine className="h-5 w-14" />}>
                  <Message
                    message="host.ranking.rank_position"
                    values={{ rank }}
                  />
                </Suspense>
              </span>
              <RankingArtwork
                alt={series.title}
                variants={series.eyeCatchImageVariants}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-serif underline-offset-4 group-hover:underline">
                  {series.title}
                </span>
                {series.creatorNames.length > 0 && (
                  <span className="block truncate text-sm text-muted-foreground">
                    {formatList(series.creatorNames, { locale })}
                  </span>
                )}
                {series.ageRating ? (
                  <span className="mt-1 block">
                    <AgeRatingBadge rating={series.ageRating} />
                  </span>
                ) : null}
              </span>
              <span className="shrink-0">
                <RankMovementMarker previousRank={previousRank} rank={rank} />
              </span>
            </LocaleLink>
          </li>
        ))}
      </ol>

      <RankingPagination
        nextToken={nextToken}
        period={period}
        previousToken={previousToken}
      />
    </>
  );
};

const RankingPage = ({ searchParams }: RankingPageProps) => (
  <main className="mx-auto max-w-4xl px-6 py-12">
    <h1 className="mb-2 font-serif text-4xl font-bold">
      <Suspense fallback={<SkeletonLine className="h-9 w-40" />}>
        <Message message="host.ranking.list_title" />
      </Suspense>
    </h1>
    <p className="mb-6 text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-5 w-80" />}>
        <Message message="host.ranking.description" />
      </Suspense>
    </p>

    <div className="mb-8">
      <Suspense fallback={<RankingTabsSkeleton />}>
        <RankingTabs searchParams={searchParams} />
      </Suspense>
    </div>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="host.ranking.list_error" />
        </Suspense>
      }
    >
      <Suspense fallback={<RankingRowsSkeleton />}>
        <RankingList searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </main>
);

export default RankingPage;
