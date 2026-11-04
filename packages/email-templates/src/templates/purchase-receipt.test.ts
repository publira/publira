import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import {
  formatBasisPointsAsPercent,
  purchaseReceiptDataSchema,
} from "./purchase-receipt";

const data = {
  amount: 500,
  coin_name: "",
  coin_pack_bonus_coins: 0,
  coin_pack_coins: 0,
  coins_expire_at: "",
  currency: "JPY",
  episode_title: "The First Night",
  expires_at: "2030-01-17T12:00:00Z",
  invoice_legal_name: "",
  invoice_registration_number: "",
  is_test: false,
  library_url: "https://aoto.example.com/my/library",
  purchased_at: "2030-01-15T12:00:00Z",
  series_bundle_episode_count: 0,
  series_title: "The Lighthouse Keeper",
  tax_amount: 0,
  tax_rate_bps: 0,
  tenant_name: "Aoto Press",
  volume_title: "",
} as const;

// A purchase of ¥550 made while the tenant's rate was 10%, from a tenant that
// entered its invoice details.
const taxed = {
  amount: 550,
  invoice_legal_name: "Aoto Press Ltd.",
  invoice_registration_number: "T1234567890123",
  tax_amount: 50,
  tax_rate_bps: 1000,
} as const;

// A purchase of a pack of 1,000 Points with 100 bonus Points.
const pack = {
  ...data,
  coin_name: "Points",
  coin_pack_bonus_coins: 100,
  coin_pack_coins: 1000,
  coins_expire_at: "2030-07-14T12:00:00Z",
  episode_title: "",
  expires_at: "",
  series_title: "",
} as const;

const render = async (
  locale: "en" | "ja",
  overrides: Partial<z.input<typeof purchaseReceiptDataSchema>> = {}
) => {
  const result = await renderEmail({
    data: { ...data, ...overrides },
    locale,
    messages: await loadEmailMessages(locale),
    template: "purchase_receipt",
    timeZone: "Asia/Tokyo",
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.html;
};

describe("purchaseReceiptDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(purchaseReceiptDataSchema.parse(data)).toEqual(data);
  });

  it("accepts a purchase with no reading period", () => {
    const forever = { ...data, expires_at: "" };

    expect(purchaseReceiptDataSchema.parse(forever)).toEqual(forever);
  });

  it("rejects an amount that is negative or not in the minor unit", () => {
    expect(
      purchaseReceiptDataSchema.safeParse({ ...data, amount: -500 }).success
    ).toBe(false);
    expect(
      purchaseReceiptDataSchema.safeParse({ ...data, amount: 4.99 }).success
    ).toBe(false);
  });

  it("rejects a currency that is not an ISO 4217 code", () => {
    expect(
      purchaseReceiptDataSchema.safeParse({ ...data, currency: "yen" }).success
    ).toBe(false);
    expect(
      purchaseReceiptDataSchema.safeParse({ ...data, currency: "XYZ" }).success
    ).toBe(false);
  });

  it("rejects a test flag that is missing or not a boolean", () => {
    expect(
      purchaseReceiptDataSchema.safeParse({ ...data, is_test: undefined })
        .success
    ).toBe(false);
    expect(
      purchaseReceiptDataSchema.safeParse({ ...data, is_test: "false" }).success
    ).toBe(false);
  });

  it("rejects a time that is not a timestamp", () => {
    expect(
      purchaseReceiptDataSchema.safeParse({
        ...data,
        purchased_at: "the fifteenth",
      }).success
    ).toBe(false);
    expect(
      purchaseReceiptDataSchema.safeParse({
        ...data,
        expires_at: "in two days",
      }).success
    ).toBe(false);
  });

  it("accepts a purchase of a volume, which names no episode", () => {
    const volume = { ...data, episode_title: "", volume_title: "Volume One" };

    expect(purchaseReceiptDataSchema.safeParse(volume).success).toBe(true);
  });

  it("rejects a purchase that names both an episode and a volume, or neither", () => {
    expect(
      purchaseReceiptDataSchema.safeParse({
        ...data,
        volume_title: "Volume One",
      }).success
    ).toBe(false);
    expect(
      purchaseReceiptDataSchema.safeParse({ ...data, episode_title: " " })
        .success
    ).toBe(false);
  });

  it("accepts a purchase of the rest of a series, which names no episode or volume", () => {
    expect(
      purchaseReceiptDataSchema.safeParse({
        ...data,
        episode_title: "",
        series_bundle_episode_count: 12,
      }).success
    ).toBe(true);
  });

  it("rejects a purchase that names an episode beside the rest of a series", () => {
    expect(
      purchaseReceiptDataSchema.safeParse({
        ...data,
        series_bundle_episode_count: 12,
      }).success
    ).toBe(false);
  });

  it("accepts a purchase of a pack, which names no series", () => {
    expect(purchaseReceiptDataSchema.safeParse(pack).success).toBe(true);
  });

  it("rejects a pack beside a series, an episode, or no coin name", () => {
    expect(
      purchaseReceiptDataSchema.safeParse({
        ...pack,
        series_title: "The Lighthouse Keeper",
      }).success
    ).toBe(false);
    expect(
      purchaseReceiptDataSchema.safeParse({
        ...pack,
        episode_title: "The First Night",
      }).success
    ).toBe(false);
    expect(
      purchaseReceiptDataSchema.safeParse({ ...data, series_title: "" }).success
    ).toBe(false);
  });

  // The worker of the release before sends none of the tax fields, and its
  // receipts still go out, without them.
  it("accepts a purchase whose data carries no tax or invoice details", () => {
    const older = {
      amount: data.amount,
      coin_name: data.coin_name,
      coin_pack_bonus_coins: data.coin_pack_bonus_coins,
      coin_pack_coins: data.coin_pack_coins,
      coins_expire_at: data.coins_expire_at,
      currency: data.currency,
      episode_title: data.episode_title,
      expires_at: data.expires_at,
      is_test: data.is_test,
      library_url: data.library_url,
      purchased_at: data.purchased_at,
      series_bundle_episode_count: data.series_bundle_episode_count,
      series_title: data.series_title,
      tenant_name: data.tenant_name,
      volume_title: data.volume_title,
    };

    expect(purchaseReceiptDataSchema.parse(older)).toEqual(data);
  });

  it("rejects a tax rate above 100%", () => {
    expect(
      purchaseReceiptDataSchema.safeParse({ ...data, tax_rate_bps: 10_001 })
        .success
    ).toBe(false);
  });

  // The console stores titles with no length limit, and a receipt whose data
  // the schema refuses is never sent.
  it("accepts any title the catalogue can hold", () => {
    expect(
      purchaseReceiptDataSchema.safeParse({
        ...data,
        episode_title: "A".repeat(1000),
      }).success
    ).toBe(true);
  });
});

describe("PurchaseReceiptEmail", () => {
  it("the en mail states the purchase in the tenant's time zone", async () => {
    const html = await render("en");

    expect(html).toContain("Thank you for your purchase");
    expect(html).toContain("Series: The Lighthouse Keeper");
    expect(html).toContain("Episode: The First Night");
    expect(html).toContain("Price paid: ¥500 (JPY)");
    expect(html).toMatch(/Purchased: Jan 15, 2030, 9:00\sPM/u);
    expect(html).toMatch(/Readable until: Jan 17, 2030, 9:00\sPM/u);
    expect(html).toContain('href="https://aoto.example.com/my/library"');
    expect(html).toContain(data.tenant_name);
    expect(html).not.toContain("Publira");
  });

  it("names the volume bought in place of an episode", async () => {
    const html = await render("en", {
      episode_title: "",
      expires_at: "",
      volume_title: "Volume One",
    });

    expect(html).toContain("Volume: Volume One");
    expect(html).toContain("Thank you for buying Volume One.");
    expect(html).not.toContain("Episode:");
  });

  it("counts the episodes of the rest of a series bought", async () => {
    const html = await render("en", {
      episode_title: "",
      expires_at: "",
      series_bundle_episode_count: 12,
    });

    expect(html).toContain("Remaining episodes: 12 episodes");
    expect(html).toContain("Thank you for buying The Lighthouse Keeper.");
    expect(html).not.toContain("Episode:");
  });

  it("names the coins of a pack and until when they can be spent", async () => {
    const html = await render("en", pack);

    expect(html).toContain("Points: 1,100 (including 100 bonus)");
    expect(html).toMatch(/Spendable until: Jul 14, 2030, 9:00\sPM/u);
    expect(html).toContain("Thank you for buying Points.");
    expect(html).not.toContain("Series:");
    expect(html).not.toContain("Episode:");
  });

  it("names the coins of a pack with no bonus in Japanese", async () => {
    const html = await render("ja", { ...pack, coin_pack_bonus_coins: 0 });

    expect(html).toContain("1,000Points");
    expect(html).not.toContain("ボーナス");
  });

  it("writes a currency with a minor unit from that unit", async () => {
    const html = await render("en", { amount: 499, currency: "USD" });

    expect(html).toContain("Price paid: $4.99 (USD)");
  });

  it("names no end for a purchase with no reading period", async () => {
    const html = await render("en", { expires_at: "" });

    expect(html).not.toContain("Readable until");
  });

  // The documented setup ends with a test purchase, and its receipt must not
  // read as a record of money taken.
  it("says a purchase in the provider's test mode charged nothing", async () => {
    expect(await render("en", { is_test: true })).toContain(
      "test mode. No money was charged."
    );
    expect(await render("en")).not.toContain("test mode");
  });

  it("states the tax the price includes and the tenant's invoice details", async () => {
    const html = await render("en", taxed);

    expect(html).toContain("Price paid: ¥550 (JPY)");
    expect(html).toContain("Tax included (10%): ¥50");
    expect(html).toContain("Issued by: Aoto Press Ltd.");
    expect(html).toContain("Registration number: T1234567890123");
  });

  it("states no tax and no invoice details for a tenant that set none", async () => {
    const html = await render("en");

    expect(html).not.toContain("Tax included");
    expect(html).not.toContain("Issued by");
    expect(html).not.toContain("Registration number");
  });

  it("states the tax in Japanese", async () => {
    const html = await render("ja", taxed);

    expect(html).toContain("うち消費税 (10%) は￥50です。");
    expect(html).toContain("登録番号はT1234567890123です。");
  });

  it("the ja mail comes from the Japanese catalog", async () => {
    const html = await render("ja");

    expect(html).toContain("ご購入ありがとうございます");
    expect(html).toContain("購入価格は￥500 (JPY) です。");
    expect(html).toContain("購入日時は2030/01/15 21:00です。");
    expect(html).toContain("有効期限は2030/01/17 21:00です。");
  });
});

describe("formatBasisPointsAsPercent", () => {
  it("writes a rate with no trailing zero", () => {
    expect(formatBasisPointsAsPercent(1000)).toBe("10");
    expect(formatBasisPointsAsPercent(850)).toBe("8.5");
    expect(formatBasisPointsAsPercent(1021)).toBe("10.21");
    expect(formatBasisPointsAsPercent(5)).toBe("0.05");
    expect(formatBasisPointsAsPercent(10_000)).toBe("100");
  });
});
