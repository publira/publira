import { describe, expect, it } from "vitest";

import { groupRoyaltyLinesByCreator } from "./royalty-lines";
import type { RoyaltyLine } from "./royalty-lines";

const line = (
  lineNumber: number,
  creatorPublicId: string,
  creatorName: string,
  payoutAmount: number
): RoyaltyLine => ({
  creatorName,
  creatorPublicId,
  episodeTitle: `Episode ${lineNumber}`,
  grossAmount: 5000,
  lineNumber,
  payoutAmount,
  refundedAmount: 0,
  roleName: "",
  saleCount: 10,
  seriesTitle: "Series A",
  shareBps: 3000,
});

describe("groupRoyaltyLinesByCreator", () => {
  it("gathers each author's lines in first-seen order with their subtotal", () => {
    const groups = groupRoyaltyLinesByCreator([
      line(1, "ARTIST", "Artist", 1500),
      line(2, "WRITER", "Writer", 1000),
      line(3, "ARTIST", "Artist", 600),
    ]);

    expect(
      groups.map((group) => ({
        lines: group.lines.map((item) => item.lineNumber),
        name: group.creatorName,
        subtotal: group.payoutSubtotal,
      }))
    ).toEqual([
      { lines: [1, 3], name: "Artist", subtotal: 2100 },
      { lines: [2], name: "Writer", subtotal: 1000 },
    ]);
  });

  it("keeps two authors with the same name apart", () => {
    const groups = groupRoyaltyLinesByCreator([
      line(1, "FIRST", "Sam", 100),
      line(2, "SECOND", "Sam", 200),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("tells deleted authors apart by the name kept on the line", () => {
    const groups = groupRoyaltyLinesByCreator([
      line(1, "", "Gone", 100),
      line(2, "", "Gone", 200),
      line(3, "", "Also gone", 300),
    ]);

    expect(groups.map((group) => group.payoutSubtotal)).toEqual([300, 300]);
  });
});
