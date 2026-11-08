import { describe, expect, it } from "vitest";

import { groupRoyaltyLinesByCreator } from "./royalty-lines";
import type { RoyaltyLine } from "./royalty-lines";

const line = (
  lineNumber: number,
  creatorPublicId: string,
  creatorName: string,
  payoutAmount: bigint,
  source: RoyaltyLine["source"] = "sale"
): RoyaltyLine => ({
  adjustedPeriod: "",
  creatorName,
  creatorPublicId,
  episodeTitle: `Episode ${lineNumber}`,
  grossAmount: 5000n,
  lineNumber,
  payoutAmount,
  refundedAmount: 0n,
  roleName: "",
  saleCount: 10,
  seriesTitle: "Series A",
  shareBps: 3000,
  source,
  taxAmount: null,
  taxRateBps: null,
});

describe("groupRoyaltyLinesByCreator", () => {
  it("gathers each author's lines in first-seen order with their subtotal", () => {
    const groups = groupRoyaltyLinesByCreator([
      line(1, "ARTIST", "Artist", 1500n),
      line(2, "WRITER", "Writer", 1000n),
      line(3, "ARTIST", "Artist", 600n),
    ]);

    expect(
      groups.map((group) => ({
        lines: group.lines.map((item) => item.lineNumber),
        name: group.creatorName,
        subtotal: group.payoutSubtotal,
      }))
    ).toEqual([
      { lines: [1, 3], name: "Artist", subtotal: 2100n },
      { lines: [2], name: "Writer", subtotal: 1000n },
    ]);
    expect(groups.map((group) => group.sourceSubtotals)).toEqual([null, null]);
  });

  it("subtotals sales and subscription shares apart for an author who has both", () => {
    const adjustment = {
      ...line(4, "ARTIST", "Artist", -30n, "subscription"),
      adjustedPeriod: "2026-07",
    };

    const [artist, writer] = groupRoyaltyLinesByCreator([
      line(1, "ARTIST", "Artist", 1500n),
      line(2, "WRITER", "Writer", 1000n),
      line(3, "ARTIST", "Artist", 294n, "subscription"),
      adjustment,
    ]);

    expect(artist?.payoutSubtotal).toBe(1764n);
    expect(artist?.sourceSubtotals).toEqual([
      { payoutAmount: 1500n, source: "sale" },
      { payoutAmount: 264n, source: "subscription" },
    ]);
    expect(writer?.sourceSubtotals).toBeNull();
  });

  it("subtotals a tip line and its adjustment apart from sales", () => {
    const adjustment = {
      ...line(3, "ARTIST", "Artist", -20n, "tip"),
      adjustedPeriod: "2026-07",
    };

    const [artist] = groupRoyaltyLinesByCreator([
      line(1, "ARTIST", "Artist", 1500n),
      line(2, "ARTIST", "Artist", 90n, "tip"),
      adjustment,
    ]);

    expect(artist?.payoutSubtotal).toBe(1570n);
    expect(artist?.sourceSubtotals).toEqual([
      { payoutAmount: 1500n, source: "sale" },
      { payoutAmount: 70n, source: "tip" },
    ]);
  });

  it("gives an author with every source a subtotal for each, in the order of the lines", () => {
    const [artist] = groupRoyaltyLinesByCreator([
      line(1, "ARTIST", "Artist", 1500n),
      line(2, "ARTIST", "Artist", 90n, "tip"),
      line(3, "ARTIST", "Artist", 294n, "subscription"),
    ]);

    expect(artist?.sourceSubtotals).toEqual([
      { payoutAmount: 1500n, source: "sale" },
      { payoutAmount: 90n, source: "tip" },
      { payoutAmount: 294n, source: "subscription" },
    ]);
  });

  it("keeps two authors with the same name apart", () => {
    const groups = groupRoyaltyLinesByCreator([
      line(1, "FIRST", "Sam", 100n),
      line(2, "SECOND", "Sam", 200n),
    ]);

    expect(groups).toHaveLength(2);
  });

  it("tells deleted authors apart by the name kept on the line", () => {
    const groups = groupRoyaltyLinesByCreator([
      line(1, "", "Gone", 100n),
      line(2, "", "Gone", 200n),
      line(3, "", "Also gone", 300n),
    ]);

    expect(groups.map((group) => group.payoutSubtotal)).toEqual([300n, 300n]);
  });
});
