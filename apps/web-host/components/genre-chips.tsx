import { cn } from "@publira/utils";

import { LocaleLink } from "#components/locale-link";
import type { PublishedGenreItem } from "#lib/catalog";

const CHIP = cn(
  "inline-flex items-center gap-2 rounded-control border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors duration-state ease-state hover:bg-muted"
);

/**
 * The tenant's genres as a row of links, in the order the console put them in.
 *
 * The count beside each name is what tells a reader whether following one is
 * worth it, and it is counted per read: a genre whose last series is taken down
 * keeps its chip and drops to zero rather than disappearing, which is the same
 * thing its page does.
 *
 * Nothing here resolves the catalog — the names are the tenant's own — so the
 * row renders wherever its caller has already read the genres.
 */
export const GenreChips = ({
  genres,
}: {
  genres: readonly PublishedGenreItem[];
}) => (
  <ul className="flex flex-wrap gap-2">
    {genres.map((genre) => (
      <li key={genre.publicId}>
        <LocaleLink className={CHIP} href={`/genres/${genre.publicId}`}>
          {genre.name}
          <span className="text-xs text-muted-foreground tabular-nums">
            {genre.publishedSeriesCount}
          </span>
        </LocaleLink>
      </li>
    ))}
  </ul>
);
