import { getMessage } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
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
import {
  currentWeekday,
  formatDate,
  formatList,
  formatWeekdayName,
} from "@publira/utils";
import type { CachedReadResult } from "@publira/utils/cached-read";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { EyeCatchFrame } from "#components/eye-catch-frame";
import { GenreChips } from "#components/genre-chips";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { RelativeTime } from "#components/relative-time";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { SeriesShelf, SeriesShelfSkeleton } from "#components/series-shelf";
import { listPublishedGenres } from "#lib/catalog";
import type { SeriesListItem } from "#lib/catalog";
import {
  getCatalogTopFeaturedAuthors,
  getCatalogTopFeaturedLabels,
  getCatalogTopFeaturedWork,
  getCatalogTopFreeSeries,
  getCatalogTopNewEpisodes,
  getCatalogTopPopularSeries,
  getCatalogTopUpdatedSeries,
  getCatalogTopWeeklySchedule,
} from "#lib/catalog-top";
import type {
  CatalogTopEpisodeItem,
  CatalogTopPopularSeries,
  CatalogTopUpdatedSeriesItem,
} from "#lib/catalog-top";
import { getLocale, loadHostMessages } from "#lib/locale";
import type { HostMessageKey } from "#lib/locale";
import { listMyRecentSeries } from "#lib/reading-progress";
import { getTenantDisplayTimeZone, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  WeeklySchedule,
  WeeklyScheduleDay,
  WeeklyScheduleDayPanel,
  WeeklyScheduleDays,
} from "./_components/weekly-schedule";

type EpisodeLinkSource = CatalogTopEpisodeItem & {
  episodePublicId?: string;
  seriesPublicId?: string;
};

type UpdatedSeriesLinkSource = CatalogTopUpdatedSeriesItem & {
  latestEpisodePublicId?: string;
  seriesPublicId?: string;
};

const resolveEpisodeLinkIds = (
  episode: EpisodeLinkSource
): { episodeId: string; seriesId: string } | null => {
  const episodeId =
    ("episodeId" in episode ? episode.episodeId : undefined) ??
    ("episodePublicId" in episode ? episode.episodePublicId : undefined) ??
    "";
  const seriesId =
    ("seriesId" in episode ? episode.seriesId : undefined) ??
    ("seriesPublicId" in episode ? episode.seriesPublicId : undefined) ??
    "";

  if (!episodeId || !seriesId) {
    return null;
  }

  return { episodeId, seriesId };
};

const resolveUpdatedSeriesLinkIds = (
  item: UpdatedSeriesLinkSource
): { latestEpisodeId: string; seriesId: string } | null => {
  const latestEpisodeId =
    ("latestEpisodeId" in item ? item.latestEpisodeId : undefined) ??
    ("latestEpisodePublicId" in item
      ? item.latestEpisodePublicId
      : undefined) ??
    "";
  const seriesId =
    ("seriesId" in item ? item.seriesId : undefined) ??
    ("seriesPublicId" in item ? item.seriesPublicId : undefined) ??
    "";

  if (!latestEpisodeId || !seriesId) {
    return null;
  }

  return { latestEpisodeId, seriesId };
};

/**
 * One title per section, shared by the section's own failure display and by the
 * `SectionErrorBoundary` around it: the reader sees the same sentence whether
 * the read reported a failure or something threw unexpectedly.
 */
const SECTION_TITLES = {
  authors: "host.top.featured_authors_error",
  continueReading: "host.top.continue_error",
  featuredWork: "host.top.featured_work_error",
  freeSeries: "host.top.free_error",
  genres: "host.top.genres_error",
  labels: "host.top.featured_labels_error",
  newEpisodes: "host.top.new_episodes_error",
  recommended: "host.top.recommended_error",
  schedule: "host.top.schedule_error",
  updated: "host.top.updated_error",
} as const satisfies Record<string, HostMessageKey>;

/** The failure body a section renders from its own `ok: false` result. */
const SectionReadError = ({
  description,
  title,
}: {
  description: string;
  title: HostMessageKey;
}) => (
  <SectionError>
    <SectionErrorHeading>
      <SectionErrorTitle>
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message={title} />
        </Suspense>
      </SectionErrorTitle>
      <SectionErrorDescription>{description}</SectionErrorDescription>
    </SectionErrorHeading>
  </SectionError>
);

/** The empty state a section renders when the read succeeded with no rows. */
const SectionEmpty = ({ message }: { message: HostMessageKey }) => (
  <EmptyState>
    <EmptyStateDescription>
      <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
        <Message message={message} />
      </Suspense>
    </EmptyStateDescription>
  </EmptyState>
);

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [siteLabel, messages] = await Promise.all([
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);

  // This page shares a route segment with `(site)/layout.tsx`, so Next.js does
  // not apply that layout's `title.template`. Compose the full tab title here.
  return {
    title: {
      absolute: `${getMessage(messages, "host.top.metadata_title")} | ${siteLabel}`,
    },
  };
};

const FeaturedWorkSkeleton = () => (
  <div className="grid gap-5">
    <Skeleton className="aspect-16/7 w-full rounded-surface" />
    <div className="grid gap-3">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-10 w-48" />
    </div>
  </div>
);

const ShelfSkeleton = ({ count = 6 }: { count?: number }) => (
  <div className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-6">
    {Array.from({ length: count }, (_, index) => (
      <div className="grid gap-2" key={index}>
        <Skeleton className="aspect-3/4 w-full rounded-surface" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    ))}
  </div>
);

/**
 * The popularity shelf's own frame, since that section draws its heading from
 * the same read as its cards: without the heading here, the row below it would
 * jump into place under a line that appeared a moment later.
 */
const PopularSectionSkeleton = () => (
  <section>
    <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
      <SkeletonLine className="h-5 w-32" />
      <SkeletonLine className="h-4 w-16" />
    </div>
    <div className="mt-6">
      <ShelfSkeleton />
    </div>
  </section>
);

const EpisodeRowsSkeleton = ({ count = 6 }: { count?: number }) => (
  <div className="divide-y divide-border">
    {Array.from({ length: count }, (_, index) => (
      <div className="flex items-center gap-4 py-3" key={index}>
        <Skeleton className="size-14 shrink-0 rounded-control" />
        <div className="flex-1 sm:flex sm:items-baseline sm:gap-4">
          <Skeleton className="h-4 w-2/3 sm:flex-1" />
          <div className="mt-2 flex items-baseline justify-between gap-3 sm:mt-0 sm:w-64 sm:shrink-0">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

const NameListSkeleton = ({ count = 6 }: { count?: number }) => (
  <div className="divide-y divide-border">
    {Array.from({ length: count }, (_, index) => (
      <div
        className="flex items-baseline justify-between gap-4 py-3"
        key={index}
      >
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
    ))}
  </div>
);

/** As many offers as the other rows on this page show. */
const maxContinueReading = 6;

/**
 * The reader's own "continue reading" row.
 *
 * It owns its heading rather than receiving one from the page, because a guest
 * and a reader who is in the middle of nothing must see the home page they
 * have always seen — heading included. Everything around it stays on the
 * shared cache: this is the one section here that reads the session, and it
 * reads it inside its own `<Suspense>` so the static shell is unaffected.
 */
const ContinueReadingSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const result = await listMyRecentSeries(tenantId, {
    limit: maxContinueReading,
    locale,
  });

  if (!result.ok) {
    return (
      <SectionReadError
        description={result.message}
        title={SECTION_TITLES.continueReading}
      />
    );
  }

  if (result.series.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="continue-reading">
      <div className="border-b border-border pb-2">
        <h2 className="font-serif text-xl leading-tight" id="continue-reading">
          <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
            <Message message="host.top.continue_heading" />
          </Suspense>
        </h2>
      </div>
      <ol className="mt-2 divide-y divide-border">
        {result.series.map(({ episode, series }) => (
          <li key={series.publicId}>
            <LocaleLink
              className="group flex items-center gap-4 py-3"
              href={`/series/${series.publicId}/episodes/${episode.publicId}`}
            >
              <EyeCatchFrame
                alt={series.title}
                className="size-14 shrink-0 rounded-control"
                sizes="56px"
                variants={series.eyeCatchImageVariants}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                    <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
                      <Message
                        message="host.common.episode_number"
                        values={{ number: episode.orderIndex }}
                      />
                    </Suspense>
                  </span>
                  <span className="truncate underline-offset-4 group-hover:underline">
                    {episode.title}
                  </span>
                </span>
                <span className="block truncate text-sm text-muted-foreground">
                  {series.title}
                </span>
              </span>
            </LocaleLink>
          </li>
        ))}
      </ol>
    </section>
  );
};

/**
 * The way into the catalogue that is neither a shelf nor a search box: the
 * tenant's own classification, as one row of links.
 *
 * A tenant that curates no genre draws nothing at all, heading included, the
 * way the continue-reading module does for a reader with no history: a heading
 * over an empty row would announce a classification this site does not have.
 */
const GenresSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const result = await listPublishedGenres(tenantId, locale);

  if (!result.ok) {
    return (
      <SectionReadError
        description={result.message}
        title={SECTION_TITLES.genres}
      />
    );
  }

  if (result.value.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="browse-genres">
      <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
        <h2 className="font-serif text-xl leading-tight" id="browse-genres">
          <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
            <Message message="host.top.genres_heading" />
          </Suspense>
        </h2>
        <LocaleLink
          className="text-sm text-primary underline underline-offset-4"
          href="/genres"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="host.top.view_all" />
          </Suspense>
        </LocaleLink>
      </div>
      <div className="mt-4">
        <GenreChips genres={result.value} />
      </div>
    </section>
  );
};

/**
 * The serials of the week, one day at a time, opened on the day it is where
 * the tenant publishes.
 *
 * `connection()` is what makes that day true. Every other read on this page is
 * cached and prerenders into the static shell, and a weekday resolved there
 * would be the day the shell was built on — a Monday module still calling
 * itself today's on Thursday. So this module alone is built per request, and
 * the seven days' series it shows are still cached reads underneath.
 *
 * The zone is the tenant's rather than the server's: which day it is where the
 * process happens to run says nothing about when the next episode arrives.
 *
 * A tenant whose series keep no weekly schedule draws nothing at all, heading
 * included, the way the genre module does — seven empty days would present a
 * schedule this site does not keep.
 */
const WeeklyScheduleSection = async () => {
  await connection();

  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [result, timeZone, messages] = await Promise.all([
    getCatalogTopWeeklySchedule(tenantId, { locale }),
    getTenantDisplayTimeZone(tenantId),
    loadHostMessages(locale),
  ]);

  if (!result.ok) {
    return (
      <SectionReadError
        description={result.message}
        title={SECTION_TITLES.schedule}
      />
    );
  }

  const days = result.value;

  if (days.every((day) => day.series.length === 0)) {
    return null;
  }

  return (
    <section aria-labelledby="weekly-schedule">
      <div className="border-b border-border pb-2">
        <h2 className="font-serif text-xl leading-tight" id="weekly-schedule">
          <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
            <Message message="host.top.schedule_heading" />
          </Suspense>
        </h2>
      </div>
      <div className="mt-4">
        <WeeklySchedule defaultWeekday={currentWeekday(timeZone)}>
          <WeeklyScheduleDays
            aria-label={getMessage(messages, "host.top.schedule_days_aria")}
          >
            {days.map((day) => (
              <WeeklyScheduleDay key={day.weekday} weekday={day.weekday}>
                {/* A weekday is calendar data, so it comes from `Intl` in the
                    reader's language rather than from the catalog. */}
                {formatWeekdayName(day.weekday, { locale, style: "short" })}
              </WeeklyScheduleDay>
            ))}
          </WeeklyScheduleDays>
          {days.map((day) => (
            <WeeklyScheduleDayPanel key={day.weekday} weekday={day.weekday}>
              {day.series.length > 0 ? (
                <SeriesShelf locale={locale} series={day.series} />
              ) : (
                <SectionEmpty message="host.top.schedule_day_empty" />
              )}
            </WeeklyScheduleDayPanel>
          ))}
        </WeeklySchedule>
      </div>
    </section>
  );
};

/**
 * The work the page opens with.
 *
 * Its title is the page's `<h1>`: a reader arrives for a work, so the first
 * thing the page names is one, rather than the site they are already looking
 * at. An empty catalogue has no work to open with and draws nothing — the
 * recommendation section below it is what says the catalogue is empty.
 */
const FeaturedWorkSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [result, timeZone] = await Promise.all([
    getCatalogTopFeaturedWork(tenantId, { locale }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok) {
    return (
      <SectionReadError
        description={result.message}
        title={SECTION_TITLES.featuredWork}
      />
    );
  }

  const featured = result.value;

  if (!featured) {
    return null;
  }

  const { latestEpisode } = featured;

  return (
    <section>
      <LocaleLink className="group block" href={`/series/${featured.seriesId}`}>
        <EyeCatchFrame
          alt={featured.seriesTitle}
          className="aspect-16/7 w-full rounded-surface"
          fetchPriority="high"
          loading="eager"
          preferredType="landscape"
          sizes="(max-width: 1200px) 100vw, 1152px"
          variants={featured.eyeCatchImageVariants}
        >
          <span className="font-serif text-2xl leading-tight text-muted-foreground">
            {featured.seriesTitle}
          </span>
        </EyeCatchFrame>
        <h1 className="mt-5 font-serif text-3xl leading-tight underline-offset-4 group-hover:underline">
          {featured.seriesTitle}
        </h1>
      </LocaleLink>
      {featured.creatorNames.length > 0 && (
        <p className="mt-2 text-muted-foreground">
          {formatList(featured.creatorNames, { locale })}
        </p>
      )}
      {latestEpisode && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <p className="text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="host.top.latest_update" />
            </Suspense>{" "}
            <span className="text-foreground tabular-nums">
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message
                  message="host.common.episode_number"
                  values={{ number: latestEpisode.orderIndex }}
                />
              </Suspense>
            </span>{" "}
            <span className="text-foreground">{latestEpisode.title}</span>{" "}
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message
                message="host.top.published_on"
                values={{
                  date: formatDate(latestEpisode.publishedAt, {
                    fallback: "",
                    locale,
                    timeZone,
                  }),
                }}
              />
            </Suspense>
          </p>
          <LinkButton
            render={
              <LocaleLink
                href={`/series/${featured.seriesId}/episodes/${latestEpisode.episodeId}`}
              />
            }
            size="lg"
            variant="secondary"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message
                message="host.top.read_episode"
                values={{ number: latestEpisode.orderIndex }}
              />
            </Suspense>
          </LinkButton>
        </div>
      )}
    </section>
  );
};

/** One card of the popularity shelf, with or without a position above it. */
const PopularSeriesCard = async ({
  rank,
  series,
}: {
  rank?: number;
  series: SeriesListItem;
}) => {
  const locale = await getLocale();

  return (
    <LocaleLink className="group block" href={`/series/${series.publicId}`}>
      <EyeCatchFrame
        alt={series.title}
        className="aspect-3/4 w-full rounded-surface"
        preferredType="portrait"
        sizes="(max-width: 640px) 33vw, 16vw"
        variants={series.eyeCatchImageVariants}
      >
        <span className="line-clamp-4 font-serif text-xs leading-tight text-muted-foreground">
          {series.title}
        </span>
      </EyeCatchFrame>
      {rank !== undefined && (
        <span className="mt-2 block font-serif text-sm leading-tight text-primary tabular-nums">
          <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
            <Message message="host.ranking.rank_position" values={{ rank }} />
          </Suspense>
        </span>
      )}
      <span className="mt-2 block font-serif text-sm leading-tight underline-offset-4 group-hover:underline">
        {series.title}
      </span>
      {series.creatorNames.length > 0 && (
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {formatList(series.creatorNames, { locale })}
        </span>
      )}
      {series.freeEpisodeCount > 0 && (
        <Badge className="mt-2" tone="success">
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message
              message="host.common.free_episode_count"
              values={{ count: series.freeEpisodeCount }}
            />
          </Suspense>
        </Badge>
      )}
    </LocaleLink>
  );
};

/**
 * What stands under the popularity heading: the chart, the cold-start shelf,
 * or what went wrong. It takes the result rather than reading again, so the
 * heading above it and the cards below it cannot disagree about which of the
 * two the tenant has.
 */
const PopularSeriesShelf = ({
  result,
}: {
  result: CachedReadResult<CatalogTopPopularSeries>;
}) => {
  if (!result.ok) {
    return (
      <SectionReadError
        description={result.message}
        title={SECTION_TITLES.recommended}
      />
    );
  }

  const popular = result.value;

  if (popular.kind === "ranked") {
    return (
      <ul className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-6">
        {popular.rankedSeries.map(({ rank, series }) => (
          <li key={series.publicId}>
            <PopularSeriesCard rank={rank} series={series} />
          </li>
        ))}
      </ul>
    );
  }

  if (popular.series.length === 0) {
    return <SectionEmpty message="host.top.recommended_empty" />;
  }

  return (
    <ul className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-6">
      {popular.series.map((series) => (
        <li key={series.publicId}>
          <PopularSeriesCard series={series} />
        </li>
      ))}
    </ul>
  );
};

/**
 * The popularity shelf: the week's chart where the ranking batch has run, and
 * the recommendation order where it has not.
 *
 * It owns its heading and its "view all" link, because both of them say which
 * of the two the reader is looking at — a chart is headed "Top 10 this week"
 * and leads to `/ranking`, a cold-start shelf keeps the wording and the
 * destination the page has always had. A failed read is the cold-start shape
 * too: `/series` is a list that always exists.
 */
const PopularSeriesSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const result = await getCatalogTopPopularSeries(tenantId, { locale });
  const ranked = result.ok && result.value.kind === "ranked";

  return (
    <section aria-labelledby="popular-works">
      <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
        <h2 className="font-serif text-xl leading-tight" id="popular-works">
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            {ranked ? (
              <Message message="host.top.ranking_heading" />
            ) : (
              <Message message="host.top.recommended_heading" />
            )}
          </Suspense>
        </h2>
        <LocaleLink
          className="text-sm text-primary underline underline-offset-4"
          href={ranked ? "/ranking" : "/series"}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="host.top.view_all" />
          </Suspense>
        </LocaleLink>
      </div>
      <div className="mt-6">
        <PopularSeriesShelf result={result} />
      </div>
    </section>
  );
};

/**
 * Where a reader can start without paying.
 *
 * The shelf is the same one the series list draws, so the free-episode count on
 * each cover is the one every other list shows; what this module adds is that
 * every cover on it has such a count.
 */
const FreeSeriesSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const result = await getCatalogTopFreeSeries(tenantId, { locale });

  if (!result.ok) {
    return (
      <SectionReadError
        description={result.message}
        title={SECTION_TITLES.freeSeries}
      />
    );
  }

  const freeSeries = result.value;

  if (freeSeries.length === 0) {
    return <SectionEmpty message="host.top.free_empty" />;
  }

  return <SeriesShelf locale={locale} series={freeSeries} />;
};

const NewEpisodesSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [result, timeZone] = await Promise.all([
    getCatalogTopNewEpisodes(tenantId, { locale }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok) {
    return (
      <SectionReadError
        description={result.message}
        title={SECTION_TITLES.newEpisodes}
      />
    );
  }

  const newEpisodes = result.value;

  if (newEpisodes.length === 0) {
    return <SectionEmpty message="host.top.new_episodes_empty" />;
  }

  return (
    <ol className="divide-y divide-border">
      {newEpisodes.map((episode) => {
        const ids = resolveEpisodeLinkIds(episode);
        if (!ids) {
          return null;
        }

        return (
          <li key={`${ids.seriesId}-${ids.episodeId}`}>
            <LocaleLink
              className="group flex items-center gap-4 py-3"
              href={`/series/${ids.seriesId}/episodes/${ids.episodeId}`}
            >
              <EyeCatchFrame
                alt={episode.seriesTitle}
                className="size-14 shrink-0 rounded-control"
                sizes="56px"
                variants={episode.eyeCatchImageVariants}
              />
              <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-4">
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                    <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
                      <Message
                        message="host.common.episode_number"
                        values={{ number: episode.episodeOrderIndex }}
                      />
                    </Suspense>
                  </span>
                  <span className="truncate underline-offset-4 group-hover:underline">
                    {episode.episodeTitle}
                  </span>
                </span>
                <span className="flex items-baseline justify-between gap-3 text-sm text-muted-foreground sm:w-64 sm:shrink-0">
                  <span className="truncate">{episode.seriesTitle}</span>
                  <span className="shrink-0">
                    <RelativeTime
                      absolute={formatDate(episode.publishedAt, {
                        fallback: "",
                        locale,
                        timeZone,
                      })}
                      timeZone={timeZone}
                      value={episode.publishedAt}
                    />
                  </span>
                </span>
              </span>
            </LocaleLink>
          </li>
        );
      })}
    </ol>
  );
};

const UpdatedSeriesSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [result, timeZone] = await Promise.all([
    getCatalogTopUpdatedSeries(tenantId, { locale }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok) {
    return (
      <SectionReadError
        description={result.message}
        title={SECTION_TITLES.updated}
      />
    );
  }

  const updatedSeries = result.value;

  if (updatedSeries.length === 0) {
    return <SectionEmpty message="host.top.updated_empty" />;
  }

  return (
    <ol className="divide-y divide-border">
      {updatedSeries.map((item) => {
        const ids = resolveUpdatedSeriesLinkIds(item);
        if (!ids) {
          return null;
        }

        return (
          <li key={ids.seriesId}>
            <LocaleLink
              className="group flex items-center gap-4 py-3"
              href={`/series/${ids.seriesId}/episodes/${ids.latestEpisodeId}`}
            >
              <EyeCatchFrame
                alt={item.seriesTitle}
                className="size-14 shrink-0 rounded-control"
                sizes="56px"
                variants={item.eyeCatchImageVariants}
              />
              <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-4">
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                    <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
                      <Message
                        message="host.common.episode_number"
                        values={{ number: item.latestEpisodeOrderIndex }}
                      />
                    </Suspense>
                  </span>
                  <span className="truncate underline-offset-4 group-hover:underline">
                    {item.latestEpisodeTitle}
                  </span>
                </span>
                <span className="flex items-baseline justify-between gap-3 text-sm text-muted-foreground sm:w-64 sm:shrink-0">
                  <span className="truncate">{item.seriesTitle}</span>
                  <span className="shrink-0">
                    <RelativeTime
                      absolute={formatDate(item.latestPublishedAt, {
                        fallback: "",
                        locale,
                        timeZone,
                      })}
                      timeZone={timeZone}
                      value={item.latestPublishedAt}
                    />
                  </span>
                </span>
              </span>
            </LocaleLink>
          </li>
        );
      })}
    </ol>
  );
};

const FeaturedLabelsSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const result = await getCatalogTopFeaturedLabels(tenantId, { locale });

  if (!result.ok) {
    return (
      <SectionReadError
        description={result.message}
        title={SECTION_TITLES.labels}
      />
    );
  }

  const featuredLabels = result.value;

  if (featuredLabels.length === 0) {
    return <SectionEmpty message="host.top.featured_labels_empty" />;
  }

  return (
    <ul className="divide-y divide-border">
      {featuredLabels.map((label) => (
        <li key={label.publicId}>
          <LocaleLink
            className="flex items-baseline justify-between gap-4 py-3 underline-offset-4 hover:underline"
            href={`/labels/${label.publicId}`}
          >
            {label.name}
          </LocaleLink>
        </li>
      ))}
    </ul>
  );
};

const FeaturedAuthorsSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const result = await getCatalogTopFeaturedAuthors(tenantId, { locale });

  if (!result.ok) {
    return (
      <SectionReadError
        description={result.message}
        title={SECTION_TITLES.authors}
      />
    );
  }

  const featuredAuthors = result.value;

  if (featuredAuthors.length === 0) {
    return <SectionEmpty message="host.top.featured_authors_empty" />;
  }

  return (
    <ul className="divide-y divide-border">
      {featuredAuthors.map((author) => (
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
  );
};

const Page = () => (
  <main className="mx-auto grid max-w-6xl gap-12 px-6 py-10">
    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message={SECTION_TITLES.featuredWork} />
        </Suspense>
      }
    >
      <Suspense fallback={<FeaturedWorkSkeleton />}>
        <FeaturedWorkSection />
      </Suspense>
    </SectionErrorBoundary>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message={SECTION_TITLES.continueReading} />
        </Suspense>
      }
    >
      <Suspense fallback={null}>
        <ContinueReadingSection />
      </Suspense>
    </SectionErrorBoundary>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message={SECTION_TITLES.genres} />
        </Suspense>
      }
    >
      <Suspense fallback={null}>
        <GenresSection />
      </Suspense>
    </SectionErrorBoundary>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message={SECTION_TITLES.schedule} />
        </Suspense>
      }
    >
      <Suspense fallback={null}>
        <WeeklyScheduleSection />
      </Suspense>
    </SectionErrorBoundary>

    <section aria-labelledby="new-episodes">
      <div className="border-b border-border pb-2">
        <h2 className="font-serif text-xl leading-tight" id="new-episodes">
          <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
            <Message message="host.top.new_episodes_heading" />
          </Suspense>
        </h2>
      </div>
      <div className="mt-2">
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message={SECTION_TITLES.newEpisodes} />
            </Suspense>
          }
        >
          <Suspense fallback={<EpisodeRowsSkeleton />}>
            <NewEpisodesSection />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </section>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message={SECTION_TITLES.recommended} />
        </Suspense>
      }
    >
      <Suspense fallback={<PopularSectionSkeleton />}>
        <PopularSeriesSection />
      </Suspense>
    </SectionErrorBoundary>

    <section aria-labelledby="free-series">
      <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
        <h2 className="font-serif text-xl leading-tight" id="free-series">
          <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
            <Message message="host.top.free_heading" />
          </Suspense>
        </h2>
        {/* The same shelf as a full list: the series a reader can start
            without paying, which is what this module shows six of. */}
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-16" />}>
          <LocaleLink
            className="text-sm text-primary underline underline-offset-4"
            href="/series?free=1"
          >
            <Message message="host.top.view_all" />
          </LocaleLink>
        </Suspense>
      </div>
      <div className="mt-6">
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message={SECTION_TITLES.freeSeries} />
            </Suspense>
          }
        >
          <Suspense fallback={<SeriesShelfSkeleton />}>
            <FreeSeriesSection />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </section>

    <section aria-labelledby="updated-series">
      <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
        <h2 className="font-serif text-xl leading-tight" id="updated-series">
          <Suspense fallback={<SkeletonLine className="h-5 w-36" />}>
            <Message message="host.top.updated_heading" />
          </Suspense>
        </h2>
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-16" />}>
          <LocaleLink
            className="text-sm text-primary underline underline-offset-4"
            href="/series"
          >
            <Message message="host.top.view_all" />
          </LocaleLink>
        </Suspense>
      </div>
      <div className="mt-2">
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message={SECTION_TITLES.updated} />
            </Suspense>
          }
        >
          <Suspense fallback={<EpisodeRowsSkeleton />}>
            <UpdatedSeriesSection />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </section>

    <div className="grid gap-12 md:grid-cols-2">
      <section aria-labelledby="featured-labels">
        <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
          <h2 className="font-serif text-xl leading-tight" id="featured-labels">
            <Suspense fallback={<SkeletonLine className="h-5 w-36" />}>
              <Message message="host.top.featured_labels_heading" />
            </Suspense>
          </h2>
          <Suspense
            fallback={<SkeletonLine className="inline-block h-4 w-16" />}
          >
            <LocaleLink
              className="text-sm text-primary underline underline-offset-4"
              href="/labels"
            >
              <Message message="host.top.view_all" />
            </LocaleLink>
          </Suspense>
        </div>
        <div className="mt-2">
          <SectionErrorBoundary
            title={
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message={SECTION_TITLES.labels} />
              </Suspense>
            }
          >
            <Suspense fallback={<NameListSkeleton />}>
              <FeaturedLabelsSection />
            </Suspense>
          </SectionErrorBoundary>
        </div>
      </section>

      <section aria-labelledby="featured-authors">
        <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
          <h2
            className="font-serif text-xl leading-tight"
            id="featured-authors"
          >
            <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
              <Message message="host.top.featured_authors_heading" />
            </Suspense>
          </h2>
          <Suspense
            fallback={<SkeletonLine className="inline-block h-4 w-16" />}
          >
            <LocaleLink
              className="text-sm text-primary underline underline-offset-4"
              href="/authors"
            >
              <Message message="host.top.view_all" />
            </LocaleLink>
          </Suspense>
        </div>
        <div className="mt-2">
          <SectionErrorBoundary
            title={
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message={SECTION_TITLES.authors} />
              </Suspense>
            }
          >
            <Suspense fallback={<NameListSkeleton />}>
              <FeaturedAuthorsSection />
            </Suspense>
          </SectionErrorBoundary>
        </div>
      </section>
    </div>
  </main>
);

export default Page;
