/**
 * Height of the reader at the top of an episode page. The body skeleton
 * reserves the same box, so the episode metadata underneath keeps its position
 * from the first paint through to the loaded viewer.
 *
 * `svh` rather than `vh` keeps a mobile browser's collapsing address bar out of
 * the measurement, and the `rem` cap stops a tall desktop window from pushing
 * everything else off screen.
 */
export const VIEWER_HEIGHT_CLASS = "h-[min(78svh,52rem)]";
