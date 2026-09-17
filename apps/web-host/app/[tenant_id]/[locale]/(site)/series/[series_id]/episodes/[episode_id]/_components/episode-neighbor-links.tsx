"use client";

import { useViewerContext } from "@publira/comic-viewer";
import { ChevronLeftIcon, ChevronRightIcon } from "@publira/icons";
import { LinkButton } from "@publira/ui-components/button";
import { cn } from "@publira/utils";

import { ClientMessage, useClientMessages } from "#components/client-message";
import { LocaleLink } from "#components/locale-link";

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
 *
 * Over a wide viewer the site header lies across the same edge while it is
 * shown, so the bar steps down beneath it.
 */
export const EpisodeNeighborLinks = ({
  nextHref,
  previousHref,
}: {
  /** Absent at the end of the series, where there is nothing to link to. */
  nextHref?: string;
  /** Absent on the first episode, for the same reason. */
  previousHref?: string;
}) => {
  const t = useClientMessages();
  const { readingDirection } = useViewerContext();

  if (nextHref === undefined && previousHref === undefined) {
    return null;
  }

  const isRightToLeft = readingDirection === "rtl";

  return (
    <nav
      aria-label={t("host.episode.navigation.label")}
      className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 transition-transform duration-state ease-state group-has-data-[wide-viewer=revealed]/document:translate-y-14"
    >
      {previousHref === undefined ? null : (
        <LinkButton
          className={cn(
            "pointer-events-auto absolute top-3",
            isRightToLeft ? "right-3" : "left-3"
          )}
          render={<LocaleLink href={previousHref} />}
          size="sm"
          variant="outline"
        >
          {isRightToLeft ? (
            <ChevronRightIcon aria-hidden="true" className="size-4" />
          ) : (
            <ChevronLeftIcon aria-hidden="true" className="size-4" />
          )}
          <ClientMessage message="host.episode.navigation.previous" />
        </LinkButton>
      )}
      {nextHref === undefined ? null : (
        <LinkButton
          className={cn(
            "pointer-events-auto absolute top-3",
            isRightToLeft ? "left-3" : "right-3"
          )}
          render={<LocaleLink href={nextHref} />}
          size="sm"
          variant="outline"
        >
          <ClientMessage message="host.episode.navigation.next" />
          {isRightToLeft ? (
            <ChevronLeftIcon aria-hidden="true" className="size-4" />
          ) : (
            <ChevronRightIcon aria-hidden="true" className="size-4" />
          )}
        </LinkButton>
      )}
    </nav>
  );
};
