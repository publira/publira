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
import { Suspense } from "react";

import { Message } from "#components/message";
import { SeriesShelf } from "#components/series-shelf";
import { listRelatedSeries } from "#lib/catalog";
import { getLocale } from "#lib/locale";

/**
 * The works a reader may want next, shown wherever one series is the subject:
 * under the series itself, and at the end of its last episode.
 *
 * The server never answers this with nothing while the tenant has another
 * published series — a work sharing no creator, label, genre or tag still joins
 * the list in ranking order — so the empty state below is what a tenant with a
 * single series sees, and nothing else.
 *
 * The heading belongs to the caller: the two places this appears in word it
 * into their own structure, and it is copy the reader sees before this read
 * resolves.
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

  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.related.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  const { series } = result.value;

  if (series.length === 0) {
    return (
      <EmptyState>
        <EmptyStateDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="host.related.list_empty" />
          </Suspense>
        </EmptyStateDescription>
      </EmptyState>
    );
  }

  return <SeriesShelf locale={locale} series={series} />;
};
