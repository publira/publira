import { cn } from "@publira/utils";

/**
 * The open and close transition of a floating layer — a dialog, a menu, a
 * popover, a toast.
 *
 * Nothing moves on page load; a transition answers something a person did, so
 * only the layers that appear because of an action carry one. Base UI marks
 * the first and last frame of a layer's life with `data-starting-style` and
 * `data-ending-style`, and keeps the element mounted until the transition
 * declared here finishes.
 *
 * `motion-reduce` removes the transition rather than shortening it, which also
 * takes the duration Base UI waits on to zero: a reader who asked for less
 * motion gets the layer immediately, not a faster fade.
 */
export const FLOATING_TRANSITION = cn(
  // `scale` rather than `transform`: Tailwind writes the scale utilities to
  // the independent `scale` property, which `transition-transform` misses.
  "transition-[opacity,scale] duration-state ease-state data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none"
);

/** The same, for a layer whose transform is already spoken for. */
export const FLOATING_FADE = cn(
  "transition-opacity duration-state ease-state data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none"
);
