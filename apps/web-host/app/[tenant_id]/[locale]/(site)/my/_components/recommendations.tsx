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
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SeriesShelf } from "#components/series-shelf";
import {
  getCatalogTopFeaturedCreators,
  getCatalogTopRecommendedSeries,
} from "#lib/catalog-top";
import { getLocale } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

/** One full shelf row, which is what both modules below show. */
const maxRecommended = 6;

export const RecommendedSeriesSkeleton = ({
  count = maxRecommended,
}: {
  count?: number;
}) => (
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

export const RecommendedCreatorsSkeleton = ({
  count = maxRecommended,
}: {
  count?: number;
}) => (
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

/**
 * What to read next, for a reader who has caught up with what they follow.
 *
 * It is the storefront's own recommendation order rather than one computed for
 * this reader, so the shelf is the shared cached read the home page already
 * fills — a reader arriving at My Page pays no round trip for it.
 */
export const RecommendedSeriesSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const result = await getCatalogTopRecommendedSeries(tenantId, {
    locale,
    maxRecommended,
  });

  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.my.recommended_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (result.value.length === 0) {
    return (
      <EmptyState>
        <EmptyStateDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="host.my.recommended_empty" />
          </Suspense>
        </EmptyStateDescription>
      </EmptyState>
    );
  }

  return (
    <SeriesShelf hideUntilConfirmed locale={locale} series={result.value} />
  );
};

/** The authors behind the catalogue, as the other half of "what next". */
export const RecommendedCreatorsSection = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const result = await getCatalogTopFeaturedCreators(tenantId, {
    locale,
    maxCreators: maxRecommended,
  });

  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.my.creators_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (result.value.length === 0) {
    return (
      <EmptyState>
        <EmptyStateDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="host.my.creators_empty" />
          </Suspense>
        </EmptyStateDescription>
      </EmptyState>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {result.value.map((creator) => (
        <li key={creator.id}>
          <LocaleLink
            className="group flex items-baseline justify-between gap-4 py-3"
            href={`/creators/${creator.id}`}
          >
            <span className="truncate underline-offset-4 group-hover:underline">
              {creator.name}
            </span>
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message
                  message="host.common.series_count"
                  values={{ count: creator.seriesCount }}
                />
              </Suspense>
            </span>
          </LocaleLink>
        </li>
      ))}
    </ul>
  );
};
