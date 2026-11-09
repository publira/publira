import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { purchaseRefundNoticeDataSchema } from "./purchase-refund-notice";

// A ¥500 episode refunded in full at once.
const data = {
  amount: 500,
  closed: true,
  coin_name: "",
  coin_pack_bonus_coins: 0,
  coin_pack_coins: 0,
  currency: "JPY",
  episode_title: "The First Night",
  is_test: false,
  is_tip: false,
  library_url: "https://aoto.example.com/my/library",
  price: 500,
  refunded_total: 500,
  series_bundle_episode_count: 0,
  series_title: "The Lighthouse Keeper",
  tenant_name: "Aoto Press",
  volume_title: "",
} as const;

// A second refund of ¥100, after one of ¥200, on the same episode.
const inPart = {
  amount: 100,
  closed: false,
  refunded_total: 300,
} as const;

// A pack of 1,000 Points with 100 bonus Points.
const pack = {
  coin_name: "Points",
  coin_pack_bonus_coins: 100,
  coin_pack_coins: 1000,
  episode_title: "",
  series_title: "",
} as const;

const render = async (
  locale: "en" | "ja",
  overrides: Partial<z.input<typeof purchaseRefundNoticeDataSchema>> = {}
) => {
  const result = await renderEmail({
    data: { ...data, ...overrides },
    locale,
    messages: await loadEmailMessages(locale),
    template: "purchase_refund_notice",
    timeZone: "Asia/Tokyo",
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.html;
};

describe("purchaseRefundNoticeDataSchema", () => {
  it("accepts the variables the sender fills in", () => {
    expect(purchaseRefundNoticeDataSchema.parse(data)).toEqual(data);
  });

  it("rejects a refund of nothing or of a fraction of the minor unit", () => {
    expect(
      purchaseRefundNoticeDataSchema.safeParse({ ...data, amount: 0 }).success
    ).toBe(false);
    expect(
      purchaseRefundNoticeDataSchema.safeParse({ ...data, amount: 4.99 })
        .success
    ).toBe(false);
  });

  it("rejects a total that leaves out the refund it is the total of", () => {
    expect(
      purchaseRefundNoticeDataSchema.safeParse({ ...data, refunded_total: 400 })
        .success
    ).toBe(false);
  });

  it("rejects a currency that is not an ISO 4217 code", () => {
    expect(
      purchaseRefundNoticeDataSchema.safeParse({ ...data, currency: "yen" })
        .success
    ).toBe(false);
  });

  it("rejects a purchase that names both an episode and a volume, or neither", () => {
    expect(
      purchaseRefundNoticeDataSchema.safeParse({
        ...data,
        volume_title: "Volume One",
      }).success
    ).toBe(false);
    expect(
      purchaseRefundNoticeDataSchema.safeParse({ ...data, episode_title: "" })
        .success
    ).toBe(false);
  });

  it("accepts a pack, which names no series, and rejects one beside a series", () => {
    expect(
      purchaseRefundNoticeDataSchema.safeParse({ ...data, ...pack }).success
    ).toBe(true);
    expect(
      purchaseRefundNoticeDataSchema.safeParse({
        ...data,
        ...pack,
        series_title: "The Lighthouse Keeper",
      }).success
    ).toBe(false);
  });
});

describe("PurchaseRefundNoticeEmail", () => {
  it("says a full refund closed what the purchase opened", async () => {
    const html = await render("en");

    expect(html).toContain("Your payment was refunded");
    expect(html).toContain("Series: The Lighthouse Keeper");
    expect(html).toContain("Episode: The First Night");
    expect(html).toContain("Amount refunded: ¥500 (JPY)");
    expect(html).toContain(
      "The purchase is refunded in full, so the episodes it opened are closed to you."
    );
    expect(html).not.toContain("Refunded in total");
    expect(html).not.toContain("stay open");
    expect(html).toContain('href="https://aoto.example.com/my/library"');
    expect(html).not.toContain("Publira");
  });

  it("states the amount and the total of a refund in part, and that the episode stays open", async () => {
    const html = await render("en", inPart);

    expect(html).toContain("Amount refunded: ¥100 (JPY)");
    expect(html).toContain("Refunded in total: ¥300 of the ¥500 paid");
    expect(html).toContain(
      "Only part of the price was refunded, so the episodes you bought stay open to you."
    );
    expect(html).not.toContain("closed to you");
  });

  it("names the volume refunded in place of an episode", async () => {
    const html = await render("en", {
      episode_title: "",
      volume_title: "Volume One",
    });

    expect(html).toContain("Volume: Volume One");
    expect(html).toContain("A refund was made on Volume One.");
    expect(html).not.toContain("Episode:");
  });

  it("counts the episodes of the rest of a series refunded", async () => {
    const html = await render("en", {
      episode_title: "",
      series_bundle_episode_count: 12,
    });

    expect(html).toContain("Remaining episodes: 12 episodes");
  });

  it("says what a refund leaves of a pack's coins", async () => {
    const full = await render("en", pack);

    expect(full).toContain("Points: 1,100 (including 100 bonus)");
    expect(full).toContain(
      "The purchase is refunded in full, so the Points it gave you that are left have been taken back."
    );
    expect(full).not.toContain("Series:");

    expect(await render("en", { ...pack, ...inPart })).toContain(
      "Only part of the price was refunded, so you keep the Points it gave you."
    );
  });

  it("says nothing of reading for a tip", async () => {
    const html = await render("en", {
      amount: 300,
      is_tip: true,
      price: 300,
      refunded_total: 300,
    });

    expect(html).toContain("Tip for the Authors of: The First Night");
    expect(html).toContain("Amount refunded: ¥300 (JPY)");
    expect(html).not.toContain("closed to you");
    expect(html).not.toContain("stay open");
  });

  it("says a refund in the provider's test mode moved no money", async () => {
    expect(await render("en", { is_test: true })).toContain(
      "test mode. No money was refunded."
    );
    expect(await render("en")).not.toContain("test mode");
  });

  it("the ja mail comes from the Japanese catalog", async () => {
    const html = await render("ja", inPart);

    expect(html).toContain("返金のお知らせ");
    expect(html).toContain("返金額は￥100 (JPY) です。");
    expect(html).toContain(
      "お支払いいただいた￥500のうち、これまでの返金額の合計は￥300です。"
    );
    expect(html).toContain(
      "返金は代金の一部のため、購入したエピソードは引き続きお読みいただけます。"
    );
  });
});
