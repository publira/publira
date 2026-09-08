"use client";

import { useViewerContext } from "@publira/comic-viewer";
import { ChevronLeftIcon, ChevronRightIcon } from "@publira/icons";

import { LocaleLink } from "#components/locale-link";

/**
 * The three strings this chrome shows, resolved on the server. The label
 * names the landmark and cannot be a node; the other two sit next to an icon
 * inside a link the component places itself.
 */
export interface EpisodeNeighborLinksCopy {
  label: string;
  next: string;
  previous: string;
}

const LINK_CLASS_NAME =
  "pointer-events-auto absolute top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-3 py-1.5 text-sm font-medium text-neutral-100 transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-100";

/**
 * Links to the episodes either side of this one, drawn over the top of the
 * reader.
 *
 * The top edge is the one part of the viewer its own controls leave empty:
 * the page-turn buttons sit halfway down each side and the toolbar runs along
 * the bottom, so a reader reaching for the next episode cannot hit a page turn
 * by mistake. The bar itself takes no pointer events, so a click that lands
 * beside a link still turns the page the way a click anywhere else on the
 * viewport does.
 *
 * Each link takes the side the page-turn button for the same direction takes,
 * which is decided by the reading direction rather than by the writing
 * direction of the page: in a right-to-left episode the previous episode is on
 * the right. The sides are set as physical classes rather than through a `dir`
 * of its own, so the labels inside them are laid out in the direction their
 * own script asks for.
 */
export const EpisodeNeighborLinks = ({
  copy,
  nextHref,
  previousHref,
}: {
  copy: EpisodeNeighborLinksCopy;
  /** Absent at the end of the series, where there is nothing to link to. */
  nextHref?: string;
  /** Absent on the first episode, for the same reason. */
  previousHref?: string;
}) => {
  const { readingDirection } = useViewerContext();

  if (nextHref === undefined && previousHref === undefined) {
    return null;
  }

  const isRightToLeft = readingDirection === "rtl";

  return (
    <nav
      aria-label={copy.label}
      className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-black/70 via-black/40 to-transparent"
    >
      {previousHref === undefined ? null : (
        <LocaleLink
          className={`${LINK_CLASS_NAME} ${isRightToLeft ? "right-3" : "left-3"}`}
          href={previousHref}
        >
          {isRightToLeft ? (
            <ChevronRightIcon aria-hidden="true" className="size-4" />
          ) : (
            <ChevronLeftIcon aria-hidden="true" className="size-4" />
          )}
          {copy.previous}
        </LocaleLink>
      )}
      {nextHref === undefined ? null : (
        <LocaleLink
          className={`${LINK_CLASS_NAME} ${isRightToLeft ? "left-3" : "right-3"}`}
          href={nextHref}
        >
          {copy.next}
          {isRightToLeft ? (
            <ChevronLeftIcon aria-hidden="true" className="size-4" />
          ) : (
            <ChevronRightIcon aria-hidden="true" className="size-4" />
          )}
        </LocaleLink>
      )}
    </nav>
  );
};
