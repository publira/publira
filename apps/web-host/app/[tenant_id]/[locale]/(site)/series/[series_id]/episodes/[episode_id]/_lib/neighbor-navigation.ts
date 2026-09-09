import type { ReadingDirection } from "@publira/comic-viewer";

/** Which of the two neighbouring episodes a control or a key press asks for. */
export type EpisodeNeighborSide = "next" | "previous";

/**
 * The neighbouring episode a horizontal arrow key asks for, or `undefined`
 * for every other key.
 *
 * It is the rule the viewer turns pages by, read one step further out: the key
 * that moves the reader forward through the pages is the key that moves them
 * forward through the series, so a right-to-left episode is left by pressing
 * <kbd>ArrowLeft</kbd> past its last page. Answering for a key that reaches no
 * end of the episode is fine — the caller only has an episode to offer at the
 * ends.
 */
export const resolveNeighborSide = (
  key: string,
  readingDirection: ReadingDirection
): EpisodeNeighborSide | undefined => {
  if (key === "ArrowLeft") {
    return readingDirection === "rtl" ? "next" : "previous";
  }
  if (key === "ArrowRight") {
    return readingDirection === "rtl" ? "previous" : "next";
  }
  return undefined;
};

/**
 * Whether a key press should be left alone because the reader is working a
 * control rather than the pages — a comment box below the viewer, a link in
 * the viewer's own chrome, the page-turn buttons.
 *
 * The viewer applies the same exception to its own keyboard handling, so
 * without this an arrow key typed into the comment form would move the reader
 * to another episode while leaving their draft behind.
 */
export const isControlKeyTarget = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest(
    "a[href], button, input, select, textarea, [contenteditable], [role='textbox']"
  ) !== null;
