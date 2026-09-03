import { describe, expect, it } from "vitest";

import { isLastPageVisible } from "./viewer-progress";

/** The reader's own pairing rule: the cover stands alone. */
const SPREAD_START_INDEX = 1;

const visible = (
  currentIndex: number,
  pageCount: number,
  viewMode: "double" | "single"
): boolean =>
  isLastPageVisible({
    currentIndex,
    pageCount,
    spreadStartIndex: SPREAD_START_INDEX,
    viewMode,
  });

describe("isLastPageVisible", () => {
  it("finds a one-page episode finished from its first paint", () => {
    expect(visible(0, 1, "single")).toBe(true);
    expect(visible(0, 1, "double")).toBe(true);
  });

  it("waits for the last page while one page is on screen", () => {
    expect(visible(0, 3, "single")).toBe(false);
    expect(visible(1, 3, "single")).toBe(false);
    expect(visible(2, 3, "single")).toBe(true);
  });

  it("counts a spread that carries the last page as finished", () => {
    // Pages 4 and 5 of five, side by side.
    expect(visible(3, 5, "double")).toBe(true);
    expect(visible(1, 5, "double")).toBe(false);
  });

  it("counts the unpaired last page of an even episode as finished", () => {
    // The cover stands alone, so page 4 of four ends up on its own.
    expect(visible(1, 4, "double")).toBe(false);
    expect(visible(3, 4, "double")).toBe(true);
  });

  it("keeps the cover alone even in a spread layout", () => {
    expect(visible(0, 2, "double")).toBe(false);
    expect(visible(1, 2, "double")).toBe(true);
  });

  it("reports nothing finished for an episode with no pages", () => {
    expect(visible(0, 0, "single")).toBe(false);
    expect(visible(0, 0, "double")).toBe(false);
  });
});
