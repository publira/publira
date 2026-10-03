import type { Locale } from "@publira/i18n";
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
import { cn, formatDateTime } from "@publira/utils";
import type { CachedReadResult } from "@publira/utils/cached-read";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { AgeRatingBadge } from "#components/age-rating-badge";
import {
  AgeRatingGate,
  AgeRatingGateActions,
  AgeRatingGateBack,
  AgeRatingGateConfirm,
  AgeRatingGateConfirmation,
  AgeRatingGateContent,
  AgeRatingGateDescription,
  AgeRatingGateHeading,
  AgeRatingGateTitle,
} from "#components/age-rating-gate";
import { CreatorCredits } from "#components/creator-credits";
import { EyeCatchPicture } from "#components/eye-catch-picture";
import type { EyeCatchVariant } from "#components/eye-catch-picture";
import {
  ListPagination,
  ListPaginationSkeleton,
  ListPaginationStep,
} from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { ageVerificationCovers } from "#lib/age-rating";
import { resolveAccessToken } from "#lib/api-client";
import { listRankedSeries, listReaderRankedSeries } from "#lib/catalog";
import type {
  RankedSeriesPage,
  RankingAgeRatingName,
  RankingPeriodName,
} from "#lib/catalog";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPageAlternates } from "#lib/page-alternates";
import { DEFAULT_RANKING_PERIOD, rankingHref } from "#lib/ranking-href";
import { getReaderProvenAgeRating, readerHasBirthDate } from "#lib/reader-age";
import {
  getTenantAgeVerification,
  getTenantDisplayTimeZone,
} from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { RankingAgeGate } from "./_components/ranking-age-gate";
import { rankMovement } from "./_lib/rank-movement";
import { rankingAgeRatingsFor } from "./_lib/ranking-age-ratings";
import { parseRankingSearchParams } from "./_lib/search-params";

const RANKING_PAGE_SIZE = 20;

type RankingPageProps = PageProps<"/[tenant_id]/[locale]/ranking">;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

/**
 * A rated chart is its own page rather than a duplicate of the all-ages one,
 * and what a crawler reads there is the age gate, so it stays out of the index.
 */
export const generateMetadata = async ({
  searchParams,
}: RankingPageProps): Promise<Metadata> => {
  const { rating } = parseRankingSearchParams(await searchParams);
  const [t, alternates] = await Promise.all([
    getMessages(),
    getPageAlternates(rankingHref({ period: DEFAULT_RANKING_PERIOD, rating })),
  ]);

  if (rating === "all") {
    return { alternates, title: t("host.ranking.list_title") };
  }

  return {
    alternates,
    robots: { index: false },
    title:
      rating === "r18"
        ? t("host.ranking.list_title_r18")
        : t("host.ranking.list_title_r15"),
  };
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
 * The ratings this reader may open. The session is read only where the
 * tenant's rule covers a rating, since that is the only case it decides.
 */
const getReaderRankingAgeRatings = async (
  tenantId: string
): Promise<RankingAgeRatingName[]> => {
  const rule = await getTenantAgeVerification(tenantId);
  const provenAgeRating =
    rule === "none" ? undefined : await getReaderProvenAgeRating(tenantId);

  return rankingAgeRatingsFor(rule, provenAgeRating);
};

/**
 * The charts, as links rather than as a control: which one is shown is part
 * of the address, so a reader can bookmark the chart they follow.
 *
 * The ratings come first, because each is a chart of its own with both
 * periods, and they are drawn only where the reader has more than all-ages to
 * choose from.
 */
const RankingTabs = async ({
  searchParams,
}: {
  searchParams: RankingPageProps["searchParams"];
}) => {
  const [resolvedSearchParams, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);
  const { period, rating } = parseRankingSearchParams(resolvedSearchParams);
  const [t, ratings] = await Promise.all([
    getMessagesFor(locale),
    getReaderRankingAgeRatings(tenantId),
  ]);

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-3">
      {ratings.length > 1 ? (
        <nav aria-label={t("host.ranking.rating_nav")} className="flex gap-2">
          <LocaleLink
            aria-current={rating === "all" ? "page" : undefined}
            className={rankingTabClassName(rating === "all")}
            href={rankingHref({ period, rating: "all" })}
          >
            {t("host.ranking.rating_all")}
          </LocaleLink>
          {ratings.includes("r15") ? (
            <LocaleLink
              aria-current={rating === "r15" ? "page" : undefined}
              className={rankingTabClassName(rating === "r15")}
              href={rankingHref({ period, rating: "r15" })}
            >
              {t("host.common.age_rating_r15")}
            </LocaleLink>
          ) : null}
          {ratings.includes("r18") ? (
            <LocaleLink
              aria-current={rating === "r18" ? "page" : undefined}
              className={rankingTabClassName(rating === "r18")}
              href={rankingHref({ period, rating: "r18" })}
            >
              {t("host.common.age_rating_r18")}
            </LocaleLink>
          ) : null}
        </nav>
      ) : null}
      <nav aria-label={t("host.ranking.period_nav")} className="flex gap-2">
        <LocaleLink
          aria-current={period === "daily" ? "page" : undefined}
          className={rankingTabClassName(period === "daily")}
          href={rankingHref({ period: "daily", rating })}
        >
          {t("host.ranking.period_daily")}
        </LocaleLink>
        <LocaleLink
          aria-current={period === "weekly" ? "page" : undefined}
          className={rankingTabClassName(period === "weekly")}
          href={rankingHref({ period: "weekly", rating })}
        >
          {t("host.ranking.period_weekly")}
        </LocaleLink>
      </nav>
    </div>
  );
};

/**
 * The pagination's `<nav>`, and the one component on this screen that resolves
 * the accessor: an `aria-label` cannot be a node. The key stays written out
 * here, beside the call that reads it.
 */
const RankingPaginationNav = async ({ children }: { children: ReactNode }) => {
  const t = await getMessages();

  return (
    <ListPagination aria-label={t("host.ranking.pagination_aria")}>
      {children}
    </ListPagination>
  );
};

/** The two directions, written once for both places this screen shows them. */
const RankingPagination = ({
  nextToken,
  period,
  previousToken,
  rating,
}: {
  nextToken: string;
  period: RankingPeriodName;
  previousToken: string;
  rating: RankingAgeRatingName;
}) => (
  <Suspense fallback={<ListPaginationSkeleton />}>
    <RankingPaginationNav>
      <ListPaginationStep
        href={
          previousToken
            ? rankingHref({ period, rating, token: previousToken })
            : ""
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep
        href={
          nextToken ? rankingHref({ period, rating, token: nextToken }) : ""
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.next_page" />
        </Suspense>
      </ListPaginationStep>
    </RankingPaginationNav>
  </Suspense>
);

/** One page of a chart, or what stands in its place. */
const RankingChart = async ({
  locale,
  period,
  rating,
  result,
  tenantId,
}: {
  locale: Locale;
  period: RankingPeriodName;
  rating: RankingAgeRatingName;
  result: CachedReadResult<RankedSeriesPage>;
  tenantId: string;
}) => {
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
      <div className="grid gap-8">
        <div className="grid gap-4 py-20 text-center">
          <p className="text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="mx-auto h-4 w-56" />}>
              <Message message="host.ranking.page_empty" />
            </Suspense>
          </p>
          {previousToken || nextToken ? null : (
            <p>
              <LocaleLink
                className="text-sm text-primary underline-offset-4 hover:underline"
                href={rankingHref({ period, rating })}
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                  <Message message="host.ranking.first_page" />
                </Suspense>
              </LocaleLink>
            </p>
          )}
        </div>
        {previousToken || nextToken ? (
          <RankingPagination
            nextToken={nextToken}
            period={period}
            previousToken={previousToken}
            rating={rating}
          />
        ) : null}
      </div>
    );
  }

  const timeZone = await getTenantDisplayTimeZone(tenantId);

  return (
    <div className="grid gap-8">
      <div>
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
                  {series.credits.length > 0 && (
                    <span className="line-clamp-2 block text-sm">
                      <CreatorCredits
                        credits={series.credits}
                        locale={locale}
                      />
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
      </div>

      <RankingPagination
        nextToken={nextToken}
        period={period}
        previousToken={previousToken}
        rating={rating}
      />
    </div>
  );
};

/**
 * The browser's own confirmation in front of a rated chart, the one a rated
 * series page asks for. Its way out is the all-ages chart of the same period.
 */
const RankingAgeRatingConfirmation = ({
  period,
  rating,
}: {
  period: RankingPeriodName;
  rating: RankingAgeRatingName;
}) => (
  <AgeRatingGateConfirmation>
    <AgeRatingGateHeading>
      <AgeRatingGateTitle>
        <Suspense fallback={<SkeletonLine className="mx-auto h-5 w-56" />}>
          {rating === "r18" ? (
            <Message message="host.ranking.age_gate.r18_title" />
          ) : (
            <Message message="host.ranking.age_gate.r15_title" />
          )}
        </Suspense>
      </AgeRatingGateTitle>
      <AgeRatingGateDescription>
        <Suspense fallback={<SkeletonLine className="mx-auto h-4 w-72" />}>
          {rating === "r18" ? (
            <Message message="host.ranking.age_gate.r18_description" />
          ) : (
            <Message message="host.ranking.age_gate.r15_description" />
          )}
        </Suspense>
      </AgeRatingGateDescription>
    </AgeRatingGateHeading>
    <AgeRatingGateActions>
      <AgeRatingGateConfirm />
      <AgeRatingGateBack href={rankingHref({ period, rating: "all" })}>
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <Message message="host.ranking.back_to_all_ages" />
        </Suspense>
      </AgeRatingGateBack>
    </AgeRatingGateActions>
  </AgeRatingGateConfirmation>
);

/**
 * The chart the URL names. A rated chart the tenant's rule covers is read with
 * the reader's session, and a reader the server refuses it to is offered the
 * way to prove an age instead of an empty list.
 */
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
  const { period, rating, token } =
    parseRankingSearchParams(resolvedSearchParams);
  const query = {
    ageRating: rating,
    limit: RANKING_PAGE_SIZE,
    locale,
    period,
    token,
  };

  if (rating === "all") {
    return (
      <RankingChart
        locale={locale}
        period={period}
        rating={rating}
        result={await listRankedSeries(tenantId, query)}
        tenantId={tenantId}
      />
    );
  }

  let result: CachedReadResult<RankedSeriesPage>;
  const rule = await getTenantAgeVerification(tenantId);
  if (ageVerificationCovers(rule, rating)) {
    const accessToken = await resolveAccessToken();
    const readerResult = await listReaderRankedSeries(
      tenantId,
      accessToken,
      query
    );
    if (!readerResult.ok) {
      result = readerResult;
    } else if (readerResult.value.access === "age_restricted") {
      const signedIn = accessToken !== "";
      return (
        <RankingAgeGate
          hasBirthDate={signedIn && (await readerHasBirthDate(tenantId))}
          period={period}
          rating={rating}
          signedIn={signedIn}
        />
      );
    } else {
      result = { ok: true, value: readerResult.value.page };
    }
  } else {
    result = await listRankedSeries(tenantId, query);
  }

  return (
    <AgeRatingGate
      provenAgeRating={await getReaderProvenAgeRating(tenantId)}
      rating={rating}
    >
      <RankingAgeRatingConfirmation period={period} rating={rating} />
      <AgeRatingGateContent>
        <RankingChart
          locale={locale}
          period={period}
          rating={rating}
          result={result}
          tenantId={tenantId}
        />
      </AgeRatingGateContent>
    </AgeRatingGate>
  );
};

const RankingPage = ({ searchParams }: RankingPageProps) => (
  <div className="mx-auto max-w-4xl px-6 py-12">
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
  </div>
);

export default RankingPage;
