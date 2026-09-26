import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { EyeCatchFrame } from "#components/eye-catch-frame";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import type { PublishedGenreItem } from "#lib/catalog";

/** The cells of the 2×2 mosaic, which a tile keeps however many covers it has. */
const MOSAIC_CELLS = [
  "top-start",
  "top-end",
  "bottom-start",
  "bottom-end",
] as const;

/**
 * What a genre's tile draws in its portrait frame. The eye-catch an editor
 * uploaded comes first, as its portrait cut filling the frame. Without one,
 * the genre's leading covers stand in as a 2×2 mosaic, so every tile is the
 * same size however many covers it has. The cells a genre cannot fill stay
 * flat, and a genre with no cover to draw — no series, or none with artwork —
 * is one flat frame carrying its name.
 */
const GenreCovers = ({ genre }: { genre: PublishedGenreItem }) => {
  if (genre.eyeCatchImageVariants) {
    return (
      <EyeCatchFrame
        alt=""
        className="aspect-3/4 w-full rounded-surface"
        preferredType="portrait"
        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
        variants={genre.eyeCatchImageVariants}
      />
    );
  }

  const covers = genre.featuredSeries.slice(0, MOSAIC_CELLS.length);

  if (!covers.some((series) => series.eyeCatchImageVariants)) {
    return (
      <EyeCatchFrame
        alt=""
        className="aspect-3/4 w-full rounded-surface"
        variants={undefined}
      >
        <span className="line-clamp-3 font-serif text-lg leading-tight text-muted-foreground">
          {genre.name}
        </span>
      </EyeCatchFrame>
    );
  }

  return (
    <span className="grid aspect-3/4 w-full grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-surface">
      {MOSAIC_CELLS.map((cell, index) => (
        <EyeCatchFrame
          alt=""
          className="size-full"
          key={cell}
          preferredType="portrait"
          sizes="(max-width: 640px) 25vw, (max-width: 1024px) 16vw, 12vw"
          variants={covers[index]?.eyeCatchImageVariants}
        />
      ))}
    </span>
  );
};

/**
 * The tenant's genres as a grid of tiles, in the order the console put them
 * in: the covers, then the name and how many series are published under it.
 *
 * Each tile is one link, and the name beneath the covers is that link's text,
 * so the covers are `alt=""` as they are on the shelf.
 */
export const GenreTiles = ({
  genres,
}: {
  genres: readonly PublishedGenreItem[];
}) => (
  <ul className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
    {genres.map((genre) => (
      <li key={genre.publicId}>
        <LocaleLink className="group block" href={`/genres/${genre.publicId}`}>
          <GenreCovers genre={genre} />
          <span className="mt-2 block font-serif text-base leading-tight underline-offset-4 group-hover:underline">
            {genre.name}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground tabular-nums">
            <Suspense fallback={<SkeletonLine className="h-3 w-24" />}>
              <Message
                message="host.common.series_count"
                values={{ count: genre.publishedSeriesCount }}
              />
            </Suspense>
          </span>
        </LocaleLink>
      </li>
    ))}
  </ul>
);

/** What stands in the grid while the genre read is in flight. */
export const GenreTilesSkeleton = ({ count }: { count: number }) => (
  <div
    aria-hidden="true"
    className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4"
  >
    {Array.from({ length: count }, (_, index) => (
      <div className="grid gap-2" key={index}>
        <Skeleton className="aspect-3/4 w-full rounded-surface" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    ))}
  </div>
);
