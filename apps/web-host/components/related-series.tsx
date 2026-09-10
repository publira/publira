import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SeriesShelf, SeriesShelfSkeleton } from "#components/series-shelf";
import { listRelatedSeries } from "#lib/catalog";
import { getLocale } from "#lib/locale";

/**
 * The works a reader may want next, shown wherever one series is the subject:
 * under the series itself, and at the end of its last episode.
 *
 * A suggestion is worth nothing to say nothing about, so this section either
 * carries covers or is not there at all — heading included, which is why the
 * heading is rendered here rather than by the caller. A read that failed leaves
 * the page it hangs under intact and complete, and a tenant whose catalogue
 * holds one series is not told that it holds one series.
 *
 * The server never answers with nothing while there is another published
 * series: a work sharing no creator, label, genre or tag still joins the list
 * in ranking order. So the empty answer is the single-series tenant, and the
 * failed one is an unreachable API.
 */
export const RelatedSeries = async ({
  limit,
  seriesPublicId,
  tenantId,
}: {
  /** How many covers this caller has room for. */
  limit: number;
  seriesPublicId: string;
  tenantId: string;
}) => {
  const locale = await getLocale();
  const result = await listRelatedSeries(tenantId, {
    limit,
    locale,
    seriesPublicId,
  });

  if (!result.ok || result.value.series.length === 0) {
    return null;
  }

  return (
    <section className="grid gap-4">
      <h2 className="border-b border-border pb-2 font-serif text-xl leading-tight">
        <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
          <Message message="host.related.heading" />
        </Suspense>
      </h2>
      <SeriesShelf locale={locale} series={result.value.series} />
    </section>
  );
};

/**
 * What stands in the section's place while the read is in flight, shaped like
 * the section rather than like the shelf alone: the heading is inside the
 * boundary too, so it has to be stood in for as well.
 */
export const RelatedSeriesSkeleton = ({ count }: { count: number }) => (
  <div className="grid gap-4">
    <Skeleton className="h-7 w-40" />
    <SeriesShelfSkeleton count={count} />
  </div>
);
