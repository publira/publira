import { describe, expect, it } from "vitest";

import type { PurchaseItem } from "#lib/purchases";

import { renderPurchasesCsv } from "./purchases-csv";

const HEADER =
  "purchase_id,purchased_at,series_title,episode_number,episode_title,price,refunded_amount,currency,expires_at,refunded_at,status\r\n";

const purchase = (overrides: Partial<PurchaseItem> = {}): PurchaseItem => ({
  currency: "USD",
  episode: { orderIndex: 3, publicId: "EPISODE001", title: "The Harbor" },
  expiresAt: "",
  id: "PURCHASE01",
  isActive: true,
  priceAtPurchase: 499,
  purchasedAt: "2026-10-01T09:00:00Z",
  refundedAmount: 0,
  refundedAt: "",
  revokedAt: "",
  series: { publicId: "SERIES001", title: "Night Ferry" },
  ...overrides,
});

describe("renderPurchasesCsv", () => {
  it("starts with a byte order mark and the header row, with CRLF line endings", () => {
    expect(renderPurchasesCsv([])).toBe(`\uFEFF${HEADER}`);
  });

  it("writes amounts in the currency itself, with its own decimal places", () => {
    const csv = renderPurchasesCsv([
      purchase(),
      purchase({ currency: "JPY", id: "PURCHASE02", priceAtPurchase: 500 }),
    ]);

    expect(csv).toBe(
      `\uFEFF${HEADER}` +
        "PURCHASE01,2026-10-01T09:00:00Z,Night Ferry,3,The Harbor,4.99,0.00,USD,,,active\r\n" +
        "PURCHASE02,2026-10-01T09:00:00Z,Night Ferry,3,The Harbor,500,0,JPY,,,active\r\n"
    );
  });

  it("marks a purchase refunded in full, and leaves a partly refunded one as it is", () => {
    const csv = renderPurchasesCsv([
      purchase({
        isActive: false,
        refundedAmount: 499,
        refundedAt: "2026-10-02T09:00:00Z",
        revokedAt: "2026-10-02T09:00:00Z",
      }),
      purchase({ id: "PURCHASE02", refundedAmount: 200 }),
      purchase({
        expiresAt: "2026-10-01T10:00:00Z",
        id: "PURCHASE03",
        isActive: false,
      }),
    ]);

    expect(csv.split("\r\n").slice(1, 4)).toEqual([
      "PURCHASE01,2026-10-01T09:00:00Z,Night Ferry,3,The Harbor,4.99,4.99,USD,,2026-10-02T09:00:00Z,refunded",
      "PURCHASE02,2026-10-01T09:00:00Z,Night Ferry,3,The Harbor,4.99,2.00,USD,,,active",
      "PURCHASE03,2026-10-01T09:00:00Z,Night Ferry,3,The Harbor,4.99,0.00,USD,2026-10-01T10:00:00Z,,expired",
    ]);
  });

  it("marks a purchase revoked with nothing refunded as canceled, not expired", () => {
    const csv = renderPurchasesCsv([
      purchase({
        expiresAt: "2099-01-01T00:00:00Z",
        isActive: false,
        revokedAt: "2026-10-02T09:00:00Z",
      }),
    ]);

    expect(csv.split("\r\n")[1]).toBe(
      "PURCHASE01,2026-10-01T09:00:00Z,Night Ferry,3,The Harbor,4.99,0.00,USD,2099-01-01T00:00:00Z,,canceled"
    );
  });

  it("quotes a title with a comma, a quote, or a line break", () => {
    const csv = renderPurchasesCsv([
      purchase({
        episode: { orderIndex: 1, publicId: "EP1", title: 'Say "hello"' },
        series: { publicId: "S1", title: "Cats, Dogs\nand more" },
      }),
    ]);

    expect(csv).toContain(',"Cats, Dogs\nand more",1,"Say ""hello""",');
  });

  it("writes a title a spreadsheet would run as a formula with a leading apostrophe", () => {
    const csv = renderPurchasesCsv([
      purchase({
        episode: { orderIndex: 1, publicId: "EP1", title: "=HYPERLINK(1)" },
        series: { publicId: "S1", title: "-5" },
      }),
    ]);

    expect(csv).toContain(",-5,1,'=HYPERLINK(1),");
  });
});
