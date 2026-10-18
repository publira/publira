"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "@publira/icons";
import type { ReactNode, UIEvent } from "react";
import { useRef, useState, useSyncExternalStore } from "react";

import { useClientMessages } from "#components/client-message";

const CONTROL =
  "inline-flex size-8 items-center justify-center rounded-control text-foreground transition-colors duration-state ease-state hover:bg-muted";

const SLIDE = "w-full shrink-0 snap-center md:w-2/3";

/**
 * How long a strip has to sit still before it counts as settled, in a browser
 * with no `scrollend` event. Long enough to outlast the gaps between the
 * scroll events of one glide, short enough that a reader does not see a copy
 * standing in for a banner.
 */
const SETTLE_DELAY_MS = 150;

const subscribeToNothing = () => () => {
  // No teardown: there is no subscription to end.
};
const loopsInBrowser = () => true;
const loopsOnServer = () => false;

/** The child of the strip whose centre is nearest the centre of the strip. */
const nearestChild = (track: HTMLElement): number => {
  const centre = track.scrollLeft + track.clientWidth / 2;
  let nearest = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const [index, slide] of [...track.children].entries()) {
    if (!(slide instanceof HTMLElement)) {
      continue;
    }
    const distance = Math.abs(
      slide.offsetLeft + slide.offsetWidth / 2 - centre
    );
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  }
  return nearest;
};

/** Scroll the strip so its `index`th child sits in the centre. */
const centreChild = (
  track: HTMLElement,
  index: number,
  behavior?: ScrollBehavior
) => {
  const slide = track.children.item(index);
  if (!(slide instanceof HTMLElement)) {
    return;
  }
  track.scrollTo({
    left: slide.offsetLeft + slide.offsetWidth / 2 - track.clientWidth / 2,
    ...(behavior ? { behavior } : {}),
  });
};

/**
 * The leading copy pushes the first banner one place to the right as it is
 * added, so the strip is moved back onto it in the same commit, before the
 * browser paints the shift.
 */
const openOnFirstBanner = (copy: HTMLLIElement | null) => {
  // The copy's own parent rather than `trackRef`: a child's ref is attached
  // before its parent's.
  const track = copy?.parentElement;
  if (track) {
    centreChild(track, 1, "instant");
  }
};

/**
 * The two buttons under the strip. Their names are the frame's rather than the
 * caller's — every strip moves to the previous and the next campaign — so each
 * reads its own from the catalog.
 */
const PreviousCampaignButton = ({ onClick }: { onClick: () => void }) => {
  const t = useClientMessages();

  return (
    <button
      aria-label={t("storefront.top.campaign_banners_previous")}
      className={CONTROL}
      onClick={onClick}
      type="button"
    >
      <ChevronLeftIcon aria-hidden="true" className="size-4" />
    </button>
  );
};

const NextCampaignButton = ({ onClick }: { onClick: () => void }) => {
  const t = useClientMessages();

  return (
    <button
      aria-label={t("storefront.top.campaign_banners_next")}
      className={CONTROL}
      onClick={onClick}
      type="button"
    >
      <ChevronRightIcon aria-hidden="true" className="size-4" />
    </button>
  );
};

/** One banner of the strip. */
export const CampaignBannerSlide = ({ children }: { children: ReactNode }) => (
  <li className={SLIDE}>{children}</li>
);

/**
 * A copy of a banner at one end of the strip, so the strip runs on past its
 * last banner into its first and back past its first into its last. It is
 * only ever looked at, never used: hidden from a screen reader, out of the tab
 * order, and taken off the screen in favour of the banner it copies as soon as
 * the strip comes to rest on it.
 */
const CampaignBannerCopy = ({
  children,
  ref,
}: {
  children: ReactNode;
  ref?: (slide: HTMLLIElement | null) => void;
}) => (
  <li aria-hidden="true" className={SLIDE} inert ref={ref}>
    {children}
  </li>
);

/**
 * Two or more banners, as one strip the reader moves through without end.
 *
 * The strip is a scroll container that snaps a banner to its centre, so a
 * swipe, a trackpad, and the keyboard focus moving onto a banner's link all
 * move it without a line of code here. The two buttons are for a pointer that
 * cannot scroll sideways, and they scroll the same container rather than
 * keeping a position of their own: which banner is current is read back off
 * the scroll, so the counter cannot disagree with what is on screen. Nothing
 * advances on a timer — a band that moves while it is being read takes the
 * banner away from the reader who was about to press it.
 *
 * The strip has no ends. A copy of the last banner stands before the first and
 * a copy of the first after the last, so the neighbours show on both sides of
 * any banner and a move past either end lands on a copy; once the strip comes
 * to rest there, it is moved to the banner the copy stands for without a
 * glide, which looks like nothing happened. The copies are added in the
 * browser, after hydration: the markup the server sends is the plain strip,
 * opened on the first banner, so a page that has not run its script yet shows
 * the same first screen it will show once it has.
 *
 * The banners arrive as {@link CampaignBannerSlide} children, already rendered
 * on the server, in a list: a list is what tells a screen reader how many there
 * are and which one it is on. `first` and `last` are the same two banners again,
 * for the copies.
 */
export const CampaignBannerCarousel = ({
  "aria-label": ariaLabel,
  children,
  count,
  first,
  last,
}: {
  "aria-label": string;
  children: ReactNode;
  count: number;
  first: ReactNode;
  last: ReactNode;
}) => {
  const trackRef = useRef<HTMLUListElement>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The child a press last aimed the strip at, until the strip comes to rest
   * there or the reader takes the strip in hand.
   */
  const targetRef = useRef<number | null>(null);
  const [current, setCurrent] = useState(0);
  const loops = useSyncExternalStore(
    subscribeToNothing,
    loopsInBrowser,
    loopsOnServer
  );

  /** Which banner a child of the strip shows, copies included. */
  const bannerAt = (child: number): number => {
    if (!loops) {
      return child;
    }
    return (child - 1 + count) % count;
  };

  /** When the strip has come to rest on a copy, put the banner in its place. */
  const settle = () => {
    const track = trackRef.current;
    if (!track) {
      return;
    }
    const child = nearestChild(track);
    // A strip that rests short of where a press aimed it is between two moves
    // — the jump off a copy ends one too — so the press still stands.
    if (targetRef.current !== null && targetRef.current !== child) {
      return;
    }
    targetRef.current = null;
    if (loops && (child === 0 || child === count + 1)) {
      centreChild(track, bannerAt(child) + 1, "instant");
    }
  };

  const forgetTarget = () => {
    targetRef.current = null;
  };

  const handleScroll = (event: UIEvent<HTMLUListElement>) => {
    setCurrent(bannerAt(nearestChild(event.currentTarget)));
    if (!("onscrollend" in window)) {
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
      }
      settleTimerRef.current = setTimeout(settle, SETTLE_DELAY_MS);
    }
  };

  /**
   * Move one banner along from where the strip is headed rather than from
   * where it is, so a second press during the glide of the first moves it on
   * again instead of aiming at the same banner twice.
   *
   * Headed for a copy, the strip is first moved onto the banner it copies,
   * at the same point of the glide — the slides between are the same distance
   * apart either way, so the frame does not change — and the press is aimed
   * from there, which is what lets presses carry on past either end.
   */
  const step = (offset: number) => {
    const track = trackRef.current;
    const [firstChild, secondChild] = track ? [...track.children] : [];
    if (!(track && firstChild instanceof HTMLElement)) {
      return;
    }
    let from = targetRef.current ?? nearestChild(track);
    if (
      loops &&
      secondChild instanceof HTMLElement &&
      (from === 0 || from === count + 1)
    ) {
      const pitch = secondChild.offsetLeft - firstChild.offsetLeft;
      const shift = from === 0 ? count : -count;
      track.scrollTo({
        behavior: "instant",
        left: track.scrollLeft + shift * pitch,
      });
      from += shift;
    }
    targetRef.current = from + offset;
    // No `behavior`: the strip's own `scroll-behavior` decides, which is how a
    // reader who asked for reduced motion gets a jump instead of a glide.
    centreChild(track, targetRef.current);
  };

  return (
    <section aria-label={ariaLabel} className="grid gap-2">
      <ul
        // A sixth of the strip outside each end is what lets the slide at that
        // end reach the centre: the first and the last banner before the
        // copies are added, and the copies after, which is what makes the move
        // off a copy land the banner exactly where the copy stood.
        className="relative flex snap-x snap-mandatory [scrollbar-width:none] gap-4 overflow-x-auto scroll-smooth motion-reduce:scroll-auto md:*:first:ms-[calc(100%/6)] md:*:last:me-[calc(100%/6)]"
        onPointerDown={forgetTarget}
        onScroll={handleScroll}
        onScrollEnd={settle}
        onWheel={forgetTarget}
        ref={trackRef}
      >
        {loops ? (
          <CampaignBannerCopy ref={openOnFirstBanner}>
            {last}
          </CampaignBannerCopy>
        ) : null}
        {children}
        {loops ? <CampaignBannerCopy>{first}</CampaignBannerCopy> : null}
      </ul>
      <div className="flex items-center justify-center gap-2">
        <PreviousCampaignButton onClick={() => step(-1)} />
        {/* The list already tells a screen reader where it is, so the counter
            is for the eye alone. */}
        <p
          aria-hidden="true"
          className="min-w-12 text-center text-sm text-muted-foreground tabular-nums"
        >
          {current + 1} / {count}
        </p>
        <NextCampaignButton onClick={() => step(1)} />
      </div>
    </section>
  );
};
