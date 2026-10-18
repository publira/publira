"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "@publira/icons";
import type { ReactNode, UIEvent } from "react";
import { useRef, useState } from "react";

const CONTROL =
  "inline-flex size-8 items-center justify-center rounded-control text-foreground transition-colors duration-state ease-state hover:bg-muted disabled:pointer-events-none disabled:text-muted-foreground/50";

/** The slide whose centre is nearest the centre of the strip. */
const nearestSlide = (track: HTMLElement): number => {
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

/**
 * Two or more banners, as one strip the reader moves through.
 *
 * The strip is a scroll container that snaps a banner to its centre, so a
 * swipe, a trackpad, and the keyboard focus moving onto a banner's link all
 * move it without a line of code here. The two buttons are for a pointer that
 * cannot scroll sideways, and they scroll the same container rather than
 * keeping a position of their own: which banner is current is read back off
 * the scroll, in the scroll event, so the counter cannot disagree with what is
 * on screen. Nothing advances on a timer — a band that moves while it is being
 * read takes the banner away from the reader who was about to press it.
 *
 * The slides arrive as children, already rendered on the server, and each one
 * is an `<li>`: a list is what tells a screen reader how many there are and
 * which one it is on.
 */
export const CampaignBannerCarousel = ({
  "aria-label": ariaLabel,
  children,
  count,
  nextLabel,
  previousLabel,
}: {
  "aria-label": string;
  children: ReactNode;
  count: number;
  nextLabel: string;
  previousLabel: string;
}) => {
  const trackRef = useRef<HTMLUListElement>(null);
  const [current, setCurrent] = useState(0);

  const handleScroll = (event: UIEvent<HTMLUListElement>) => {
    setCurrent(nearestSlide(event.currentTarget));
  };

  const scrollToSlide = (index: number) => {
    const track = trackRef.current;
    const slide = track?.children.item(index);
    if (!(track && slide instanceof HTMLElement)) {
      return;
    }
    // No `behavior`: the strip's own `scroll-behavior` decides, which is how a
    // reader who asked for reduced motion gets a jump instead of a glide.
    track.scrollTo({
      left: slide.offsetLeft + slide.offsetWidth / 2 - track.clientWidth / 2,
    });
  };

  return (
    <section aria-label={ariaLabel} className="grid gap-2">
      <ul
        className="relative flex snap-x snap-mandatory [scrollbar-width:none] gap-4 overflow-x-auto scroll-smooth motion-reduce:scroll-auto"
        onScroll={handleScroll}
        ref={trackRef}
      >
        {children}
      </ul>
      <div className="flex items-center justify-center gap-2">
        <button
          aria-label={previousLabel}
          className={CONTROL}
          disabled={current === 0}
          onClick={() => scrollToSlide(current - 1)}
          type="button"
        >
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
        </button>
        {/* The list already tells a screen reader where it is, so the counter
            is for the eye alone. */}
        <p
          aria-hidden="true"
          className="min-w-12 text-center text-sm text-muted-foreground tabular-nums"
        >
          {current + 1} / {count}
        </p>
        <button
          aria-label={nextLabel}
          className={CONTROL}
          disabled={current >= count - 1}
          onClick={() => scrollToSlide(current + 1)}
          type="button"
        >
          <ChevronRightIcon aria-hidden="true" className="size-4" />
        </button>
      </div>
    </section>
  );
};
