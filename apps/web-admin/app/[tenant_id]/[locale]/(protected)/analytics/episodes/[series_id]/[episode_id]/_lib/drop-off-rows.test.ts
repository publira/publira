import { describe, expect, it } from "vitest";

import { toDropOffRows } from "./drop-off-rows";

describe("toDropOffRows", () => {
  it("counts as leaving at a page the readers who did not reach the next", () => {
    expect(
      toDropOffRows([
        { pageIndex: 0, readerCount: 10n },
        { pageIndex: 1, readerCount: 6n },
        { pageIndex: 2, readerCount: 6n },
      ])
    ).toEqual([
      { leftCount: 4n, pageIndex: 0, readerCount: 10n },
      { leftCount: 0n, pageIndex: 1, readerCount: 6n },
      { leftCount: 6n, pageIndex: 2, readerCount: 6n },
    ]);
  });

  it("has nothing for an episode no reader reached", () => {
    expect(toDropOffRows([])).toEqual([]);
  });
});
