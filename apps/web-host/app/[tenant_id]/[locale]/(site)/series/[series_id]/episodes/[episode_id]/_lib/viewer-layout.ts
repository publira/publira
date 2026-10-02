import { cn } from "@publira/utils";

/**
 * Height of the reader at the top of an episode page. The body skeleton
 * reserves the same box, so the episode metadata underneath keeps its position
 * from the first paint through to the loaded viewer.
 *
 * `svh` rather than `vh` keeps a mobile browser's collapsing address bar out of
 * the measurement, and the `rem` cap stops a tall desktop window from pushing
 * everything else off screen.
 */
export const VIEWER_HEIGHT_CLASS = cn("h-[min(78svh,52rem)]");

/**
 * The same box as a floor rather than a fixed height, for the gate that stands
 * where the reader would be. On a phone its card can hold more than the box has
 * room for, and the page grows around it rather than scrolling a second time
 * inside the frame.
 */
export const VIEWER_MIN_HEIGHT_CLASS = cn("min-h-[min(78svh,52rem)]");
