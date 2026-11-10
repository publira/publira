import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import type { subscriptionPaymentFailedDataSchema } from "./subscription-payment-failed";

// A failed attempt at the ¥980 renewal of a monthly plan whose current period
// ends on 2 May, tried again on 5 April.
const data = {
  amount: 980,
  currency: "JPY",
  is_test: false,
  my_page_url: "https://aoto.example.com/my",
  next_attempt: "2026-04-05T03:00:00Z",
  period_end: "2026-05-02T00:00:00Z",
  plan_name: "All you can read",
  tenant_name: "Aoto Press",
} as const;

const render = async (
  locale: "en" | "ja",
  overrides: Partial<z.input<typeof subscriptionPaymentFailedDataSchema>> = {}
) => {
  const result = await renderEmail({
    data: { ...data, ...overrides },
    locale,
    messages: await loadEmailMessages(locale),
    template: "subscription_payment_failed",
    timeZone: "Asia/Tokyo",
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.html;
};

describe("subscription_payment_failed", () => {
  it("names the plan, the amount due, the next attempt, and until when the episodes stay open", async () => {
    const html = await render("en");

    expect(html).toContain("Your payment did not go through");
    expect(html).toContain(
      "The payment for All you can read did not go through."
    );
    expect(html).toContain("Plan: All you can read");
    expect(html).toContain("Amount due: ¥980 (JPY)");
    expect(html).toContain(
      "The payment will be tried again on Apr 5, 2026, 12:00 PM."
    );
    expect(html).toContain(
      "you can read the episodes the plan covers until May 2, 2026, 9:00 AM at the latest."
    );
    expect(html).not.toContain("test mode");
    expect(html).not.toContain("Publira");
  });

  it("says nothing of the retries when the provider named no next attempt", async () => {
    const html = await render("en", { next_attempt: "" });

    expect(html).not.toContain("tried again");
    expect(html).toContain("until May 2, 2026, 9:00 AM at the latest.");
  });

  it("sends the reader to My Page, where Manage billing changes the card", async () => {
    const html = await render("en");

    expect(html).toContain(
      "To keep reading, update your payment method under Manage billing on My Page."
    );
    expect(html).toContain("Open My Page");
    expect(html).toContain('href="https://aoto.example.com/my"');
  });

  it("says an attempt in the provider's test mode owes nothing", async () => {
    const html = await render("en", { is_test: true });

    expect(html).toContain(
      "This payment was attempted in the payment provider"
    );
    expect(html).toContain("No money is owed.");
  });

  it.each([
    { name: "an amount of nothing", overrides: { amount: 0 } },
    {
      name: "a next attempt that is no instant",
      overrides: { next_attempt: "soon" },
    },
  ])("refuses $name", async ({ overrides }) => {
    const result = await renderEmail({
      data: { ...data, ...overrides },
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "subscription_payment_failed",
      timeZone: "Asia/Tokyo",
    });

    expect(result.ok).toBe(false);
  });

  it("the ja mail comes from the Japanese catalog", async () => {
    const html = await render("ja");

    expect(html).toContain("お支払いが完了しませんでした");
    expect(html).toContain("プラン「All you can read」");
    expect(html).toContain("未払いの金額は￥980 (JPY) です。");
    expect(html).toContain("2026/04/05 12:00にもう一度お支払いを試みます。");
    expect(html).toContain(
      "お支払いが完了するまでは、遅くとも2026/05/02 9:00まで、このプランの対象のエピソードを読めます。"
    );
  });
});
