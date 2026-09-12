import type { Locale } from "@publira/i18n";
import { Badge } from "@publira/ui-components/badge";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatList } from "@publira/utils";
import { Suspense } from "react";

import { AgeRatedVisibility } from "#components/age-rated-visibility";
import { AgeRatingBadge } from "#components/age-rating-badge";
import { EyeCatchFrame } from "#components/eye-catch-frame";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import type { SeriesListItem } from "#lib/catalog";

/**
 * A row of portrait covers with the title and the creators beneath each one.
 *
 * The design gives grids to covers and nothing else, so this is the one shape
 * a list of works takes: the series list, and the series a label or a creator
 * page carries. Six across on a desktop and three on a phone, which is the
 * width a cover keeps its title legible at.
 *
 * Each cover is one link, and the title beneath it is that link's own text —
 * so the artwork is `alt=""` and the rectangle that stands in for a missing
 * one is hidden, or a reader hears every shelf twice.
 *
 * A series a reader can start without paying carries how many episodes that
 * is, inside the link rather than beside it: it is what decides whether this
 * cover is worth opening, so it belongs to the link's own text.
 */
export const SeriesShelf = ({
  hideUntilConfirmed = false,
  locale,
  series,
}: {
  /**
   * Home modules hide rated covers until this browser has confirmed, so the
   * cached shelf can still list every series. Catalogue pages leave this off:
   * the badge is the warning, and the series page is where the reader confirms.
   */
  hideUntilConfirmed?: boolean;
  locale: Locale;
  series: SeriesListItem[];
}) => (
  <ul className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-6">
    {series.map((item) => {
      const card = (
        <li key={item.publicId}>
          <LocaleLink className="group block" href={`/series/${item.publicId}`}>
            <EyeCatchFrame
              alt=""
              className="aspect-3/4 w-full rounded-surface"
              preferredType="portrait"
              sizes="(max-width: 640px) 33vw, 16vw"
              variants={item.eyeCatchImageVariants}
            >
              <span className="line-clamp-4 font-serif text-xs leading-tight text-muted-foreground">
                {item.title}
              </span>
            </EyeCatchFrame>
            <span className="mt-2 block font-serif text-sm leading-tight underline-offset-4 group-hover:underline">
              {item.title}
            </span>
            {item.creatorNames.length > 0 && (
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {formatList(item.creatorNames, { locale })}
              </span>
            )}
            {(item.ageRating || item.freeEpisodeCount > 0) && (
              <span className="mt-2 flex flex-wrap gap-2">
                <AgeRatingBadge rating={item.ageRating} />
                {item.freeEpisodeCount > 0 && (
                  <Badge tone="success">
                    <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                      <Message
                        message="host.common.free_episode_count"
                        values={{ count: item.freeEpisodeCount }}
                      />
                    </Suspense>
                  </Badge>
                )}
              </span>
            )}
          </LocaleLink>
        </li>
      );

      return hideUntilConfirmed ? (
        <AgeRatedVisibility key={item.publicId} rating={item.ageRating}>
          {card}
        </AgeRatedVisibility>
      ) : (
        card
      );
    })}
  </ul>
);

/** What stands on the shelf while the catalogue read is in flight. */
export const SeriesShelfSkeleton = ({ count = 6 }: { count?: number }) => (
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
