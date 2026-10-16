import type { PageStatusValue } from "@publira/comic-viewer";
import { describe, expect, it } from "vitest";

import { describeVisiblePages } from "./page-status";

const value = (overrides: Partial<PageStatusValue>): PageStatusValue => ({
  currentIndex: 0,
  firstPage: 1,
  lastPage: 1,
  pageCount: 4,
  viewMode: "double",
  ...overrides,
});

describe("describeVisiblePages", () => {
  it("names one page with the total", () => {
    expect(describeVisiblePages(value({}))).toEqual({
      first: 1,
      kind: "page",
      total: 4,
    });
  });

  it("names both pages of a spread", () => {
    expect(describeVisiblePages(value({ firstPage: 2, lastPage: 3 }))).toEqual({
      first: 2,
      kind: "spread",
      last: 3,
      total: 4,
    });
  });

  it("names the end page, which carries no page number", () => {
    expect(
      describeVisiblePages(
        value({ currentIndex: 4, firstPage: 0, lastPage: 0, slot: "end" })
      )
    ).toEqual({ kind: "end-page" });
  });

  it("reports nothing on screen for an episode with no pages", () => {
    expect(
      describeVisiblePages(value({ firstPage: 0, lastPage: 0, pageCount: 0 }))
    ).toEqual({ kind: "none" });
  });

  it("reports nothing on screen for a start page, which this shell does not draw", () => {
    expect(
      describeVisiblePages(
        value({ currentIndex: -1, firstPage: 0, lastPage: 0, slot: "start" })
      )
    ).toEqual({ kind: "none" });
  });
});
