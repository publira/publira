import { cn } from "@publira/utils";

/**
 * One classification worn as a link: a genre on the home page or a series
 * page, and the same shape wherever else a reader steps sideways into the
 * catalogue by a name the tenant gave it.
 *
 * A class rather than a component, because the element differs per call site —
 * a genre chip carries a count beside its name, a tag chip does not — and a
 * component that only assembled a `<LocaleLink>` would hide the href and the
 * label behind props the caller can already write.
 */
export const CHIP = cn(
  "inline-flex items-center gap-2 rounded-control border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors duration-state ease-state hover:bg-muted"
);

/**
 * A tag chip, standing next to the genre chips of the same series.
 *
 * The two are not the same kind of thing — a genre is one of a short list the
 * tenant curates, a tag is whatever an editor typed on the series form — so a
 * row that drew them identically would present a one-off word as part of the
 * site's own classification. The dashed edge is what says which is which
 * without a heading over each row.
 */
export const TAG_CHIP = cn(CHIP, "border-dashed text-muted-foreground");
