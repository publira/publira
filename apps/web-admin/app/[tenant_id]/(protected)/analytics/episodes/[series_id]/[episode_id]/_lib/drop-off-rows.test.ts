import { describe, expect, it } from "vitest";

import { toDropOffRows } from "./drop-off-rows";

describe("toDropOffRows", () => {
  it("counts as leaving at a page the readers who did not reach the next", () => {
    expect(
      toDropOffRows([
        { pageIndex: 0, readerCount: 10 },
        { pageIndex: 1, readerCount: 6 },
        { pageIndex: 2, readerCount: 6 },
      ])
    ).toEqual([
      { leftCount: 4, pageIndex: 0, readerCount: 10 },
      { leftCount: 0, pageIndex: 1, readerCount: 6 },
      { leftCount: 6, pageIndex: 2, readerCount: 6 },
    ]);
  });

  it("has nothing for an episode no reader reached", () => {
    expect(toDropOffRows([])).toEqual([]);
  });
});
