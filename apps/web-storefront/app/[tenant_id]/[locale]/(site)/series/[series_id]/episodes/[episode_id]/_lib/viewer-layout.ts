import { cn } from "@publira/utils";

/**
 * Height of the reader at the top of an episode page. The body skeleton
 * reserves the same box, so the episode metadata underneath keeps its position
 * from the first paint through to the loaded viewer.
 *
 * `svh` rather than `vh` keeps a mobile browser's collapsing address bar out of
 * the measurement. In a landscape window the `rem` cap stops a tall desktop
 * screen from pushing everything else off it; in a portrait one there is no
 * cap, because the reader shows one page there and that page is drawn at the
 * height of the box. With the cap, a tablet held upright got a box about as
 * wide as it is tall, too short for one page to fill and wide enough to be
 * taken for a spread.
 */
export const VIEWER_HEIGHT_CLASS = cn(
  "h-[78svh] landscape:h-[min(78svh,52rem)]"
);

/**
 * The same box as a floor rather than a fixed height, for the gate that stands
 * where the reader would be. On a phone its card can hold more than the box has
 * room for, and the page grows around it rather than scrolling a second time
 * inside the frame.
 */
export const VIEWER_MIN_HEIGHT_CLASS = cn(
  "min-h-[78svh] landscape:min-h-[min(78svh,52rem)]"
);
