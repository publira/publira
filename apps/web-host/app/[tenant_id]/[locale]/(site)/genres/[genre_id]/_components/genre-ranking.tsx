import type { Locale } from "@publira/i18n";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { CachedReadResult } from "@publira/utils/cached-read";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SeriesShelfCard } from "#components/series-shelf";
import type { RankedSeriesPage } from "#lib/catalog";
import { rankingHref } from "#lib/ranking-href";

/** One shelf of the chart: six across on a desktop, the width a shelf lays out. */
export const GENRE_RANKING_SHELF_SIZE = 6;

/**
 * The leaders of a genre's weekly chart, and the way to the rest of it.
 *
 * A genre the ranking batch has not reached yet, or one nobody has read this
 * week, draws nothing at all, heading included, the way the top page's genre
 * module does for a tenant with no genres: a heading over an empty row would
 * announce a chart this genre does not have, and the page then opens on its
 * filterable list as it did before rankings existed.
 *
 * The link opens the weekly chart, since that is the period this shelf is the
 * head of. A genre's chart is an all-ages one, so no cover on it is hidden.
 */
export const GenreRanking = ({
  genreId,
  locale,
  result,
}: {
  genreId: string;
  locale: Locale;
  result: CachedReadResult<RankedSeriesPage>;
}) => {
  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.genres.ranking_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  const { rankedSeries } = result.value;

  if (rankedSeries.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="genre-ranking">
      <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
        <h2 className="font-serif text-xl leading-tight" id="genre-ranking">
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <Message message="host.genres.ranking_heading" />
          </Suspense>
        </h2>
        <LocaleLink
          className="text-sm text-primary underline underline-offset-4"
          href={rankingHref({
            genre: genreId,
            period: "weekly",
            rating: "all",
          })}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="host.genres.ranking_link" />
          </Suspense>
        </LocaleLink>
      </div>
      <div className="mt-6">
        <ol className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-6">
          {rankedSeries.map(({ rank, series }) => (
            <li key={series.publicId}>
              <SeriesShelfCard item={series} locale={locale} rank={rank} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
};
