import { describe, expect, it } from "vitest";

import type {
  MyCreatorStatementItem,
  MyCreatorStatementLineItem,
} from "#lib/creator-pages";

import { renderStatementCsv } from "./statement-csv";

const HEADER =
  "period,role_name,series_id,series_title,episode_id,episode_title,sale_count,gross_amount,refunded_amount,share_percent,payout_amount,currency,adjusted_period,source\r\n";

const statement: MyCreatorStatementItem = {
  closedAt: "2026-01-05T10:00:00Z",
  currency: "JPY",
  grossAmount: 4000,
  payoutAmount: 1200,
  period: "2025-12",
  refundedAmount: 0,
  saleCount: 8,
  timeZone: "UTC",
};

const line = (
  overrides: Partial<MyCreatorStatementLineItem> = {}
): MyCreatorStatementLineItem => ({
  adjustedPeriod: "",
  episodePublicId: "EPISODE00001",
  episodeTitle: "The Harbor",
  grossAmount: 4000,
  lineNumber: 1,
  payoutAmount: 1200,
  refundedAmount: 0,
  roleName: "Artist",
  saleCount: 8,
  seriesPublicId: "SERIES000001",
  seriesTitle: "Night Ferry",
  shareBps: 3000,
  source: "sale",
  ...overrides,
});

describe("renderStatementCsv", () => {
  it("starts with a byte order mark and the header row, with CRLF line endings", () => {
    expect(renderStatementCsv({ lines: [], statement })).toBe(
      `\uFEFF${HEADER}`
    );
  });

  it("writes one row per line as the console's export does, minor units and two-decimal shares", () => {
    const csv = renderStatementCsv({
      lines: [
        line(),
        line({
          lineNumber: 3,
          roleName: "",
          shareBps: 1250,
          source: "subscription",
        }),
        line({
          adjustedPeriod: "2025-11",
          grossAmount: -500,
          lineNumber: 7,
          payoutAmount: -150,
          refundedAmount: -500,
          saleCount: -1,
        }),
      ],
      statement,
    });

    expect(csv).toBe(
      `\uFEFF${HEADER}` +
        "2025-12,Artist,SERIES000001,Night Ferry,EPISODE00001,The Harbor,8,4000,0,30.00,1200,JPY,,sale\r\n" +
        "2025-12,,SERIES000001,Night Ferry,EPISODE00001,The Harbor,8,4000,0,12.50,1200,JPY,,subscription\r\n" +
        "2025-12,Artist,SERIES000001,Night Ferry,EPISODE00001,The Harbor,-1,-500,-500,30.00,-150,JPY,2025-11,sale\r\n"
    );
  });

  it("keeps a title a spreadsheet would run as a formula as text", () => {
    const csv = renderStatementCsv({
      lines: [line({ episodeTitle: "=HYPERLINK(1)", seriesTitle: "A, B" })],
      statement,
    });

    expect(csv).toContain(`"A, B",EPISODE00001,'=HYPERLINK(1),`);
  });
});
