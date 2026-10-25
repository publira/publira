import { describe, expect, it } from "vitest";

import type { PurchaseItem } from "#lib/purchases";

import { renderPurchasesCsv } from "./purchases-csv";

const HEADER =
  "purchase_id,purchased_at,series_title,episode_number,episode_title,price,refunded_amount,currency,expires_at,refunded_at,status,item,volume_title,coins,bonus_coins\r\n";

const purchase = (overrides: Partial<PurchaseItem> = {}): PurchaseItem => ({
  currency: "USD",
  expiresAt: "",
  id: "PURCHASE01",
  isActive: true,
  item: {
    kind: "episode",
    orderIndex: 3,
    publicId: "EPISODE001",
    title: "The Harbor",
  },
  kind: "purchase",
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
        "PURCHASE01,2026-10-01T09:00:00Z,Night Ferry,3,The Harbor,4.99,0.00,USD,,,active,episode,,,\r\n" +
        "PURCHASE02,2026-10-01T09:00:00Z,Night Ferry,3,The Harbor,500,0,JPY,,,active,episode,,,\r\n"
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
      "PURCHASE01,2026-10-01T09:00:00Z,Night Ferry,3,The Harbor,4.99,4.99,USD,,2026-10-02T09:00:00Z,refunded,episode,,,",
      "PURCHASE02,2026-10-01T09:00:00Z,Night Ferry,3,The Harbor,4.99,2.00,USD,,,active,episode,,,",
      "PURCHASE03,2026-10-01T09:00:00Z,Night Ferry,3,The Harbor,4.99,0.00,USD,2026-10-01T10:00:00Z,,expired,episode,,,",
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
      "PURCHASE01,2026-10-01T09:00:00Z,Night Ferry,3,The Harbor,4.99,0.00,USD,2099-01-01T00:00:00Z,,canceled,episode,,,"
    );
  });

  it("quotes a title with a comma, a quote, or a line break", () => {
    const csv = renderPurchasesCsv([
      purchase({
        item: {
          kind: "episode",
          orderIndex: 1,
          publicId: "EP1",
          title: 'Say "hello"',
        },
        series: { publicId: "S1", title: "Cats, Dogs\nand more" },
      }),
    ]);

    expect(csv).toContain(',"Cats, Dogs\nand more",1,"Say ""hello""",');
  });

  it("writes a title a spreadsheet would run as a formula with a leading apostrophe", () => {
    const csv = renderPurchasesCsv([
      purchase({
        item: {
          kind: "episode",
          orderIndex: 1,
          publicId: "EP1",
          title: "=HYPERLINK(1)",
        },
        series: { publicId: "S1", title: "-5" },
      }),
    ]);

    expect(csv).toContain(",-5,1,'=HYPERLINK(1),");
  });

  it("names a volume in its own column, and leaves the episode columns of a volume and of the rest of a series empty", () => {
    const csv = renderPurchasesCsv([
      purchase({
        item: { kind: "volume", publicId: "VOLUME001", title: "Volume 1" },
        priceAtPurchase: 1200,
      }),
      purchase({
        id: "PURCHASE02",
        item: { episodeCount: 4, kind: "series_bundle" },
        priceAtPurchase: 1800,
      }),
    ]);

    expect(csv.split("\r\n").slice(1, 3)).toEqual([
      "PURCHASE01,2026-10-01T09:00:00Z,Night Ferry,,,12.00,0.00,USD,,,active,volume,Volume 1,,",
      "PURCHASE02,2026-10-01T09:00:00Z,Night Ferry,,,18.00,0.00,USD,,,active,remaining_episodes,,,",
    ]);
  });

  it("counts the coins of a pack, its bonus among them, in columns of their own", () => {
    const csv = renderPurchasesCsv([
      purchase({
        item: {
          bonusCoins: 100,
          coinName: "Points",
          coins: 1000,
          kind: "coin_pack",
        },
        priceAtPurchase: 1000,
        series: { publicId: "", title: "" },
      }),
    ]);

    expect(csv.split("\r\n")[1]).toBe(
      "PURCHASE01,2026-10-01T09:00:00Z,,,,10.00,0.00,USD,,,active,coin_pack,,1100,100"
    );
  });
});
