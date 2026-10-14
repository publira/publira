import { describe, expect, it } from "vitest";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import { purchaseReceiptDataSchema } from "./purchase-receipt";

const data = {
  amount: 500,
  currency: "JPY",
  episode_title: "The First Night",
  expires_at: "2030-01-17T12:00:00Z",
  library_url: "https://aoto.example.com/my/library",
  purchased_at: "2030-01-15T12:00:00Z",
  series_title: "The Lighthouse Keeper",
  tenant_name: "Aoto Press",
} as const;

const render = async (
  locale: "en" | "ja",
  overrides: Partial<Record<keyof typeof data, unknown>> = {}
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

  it("writes a currency with a minor unit from that unit", async () => {
    const html = await render("en", { amount: 499, currency: "USD" });

    expect(html).toContain("Price paid: $4.99 (USD)");
  });

  it("names no end for a purchase with no reading period", async () => {
    const html = await render("en", { expires_at: "" });

    expect(html).not.toContain("Readable until");
  });

  it("the ja mail comes from the Japanese catalog", async () => {
    const html = await render("ja");

    expect(html).toContain("ご購入ありがとうございます");
    expect(html).toContain("購入価格: ￥500（JPY）");
    expect(html).toContain("購入日時: 2030/01/15 21:00");
    expect(html).toContain("有効期限: 2030/01/17 21:00");
  });
});
