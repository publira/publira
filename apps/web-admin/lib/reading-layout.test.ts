import { describe, expect, it } from "vitest";

import { resolveReadingLayout } from "./reading-layout";

const series = { readingDirection: "rtl", spreadStartIndex: 1 } as const;

describe("resolveReadingLayout", () => {
  it("follows the series where the episode states nothing", () => {
    expect(resolveReadingLayout({ readingDirection: "" }, series)).toEqual(
      series
    );
  });

  it("takes each value the episode states over the series'", () => {
    expect(
      resolveReadingLayout(
        { readingDirection: "ltr", spreadStartIndex: 0 },
        series
      )
    ).toEqual({ readingDirection: "ltr", spreadStartIndex: 0 });
  });

  it("resolves the direction and the spread start independently", () => {
    expect(
      resolveReadingLayout(
        { readingDirection: "", spreadStartIndex: 2 },
        series
      )
    ).toEqual({ readingDirection: "rtl", spreadStartIndex: 2 });
    expect(resolveReadingLayout({ readingDirection: "ltr" }, series)).toEqual({
      readingDirection: "ltr",
      spreadStartIndex: 1,
    });
  });
});
