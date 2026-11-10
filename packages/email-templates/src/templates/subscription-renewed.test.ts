import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import type { subscriptionPaymentDataSchema } from "./subscription-payment";

// The second month of a ¥980 monthly plan, from 2 April to 2 May.
const data = {
  amount: 980,
  currency: "JPY",
  is_test: false,
  my_page_url: "https://aoto.example.com/my",
  period_end: "2026-05-02T00:00:00Z",
  period_start: "2026-04-02T00:00:00Z",
  plan_name: "All you can read",
  tenant_name: "Aoto Press",
} as const;

const render = async (
  locale: "en" | "ja",
  overrides: Partial<z.input<typeof subscriptionPaymentDataSchema>> = {}
) => {
  const result = await renderEmail({
    data: { ...data, ...overrides },
    locale,
    messages: await loadEmailMessages(locale),
    template: "subscription_renewed",
    timeZone: "Asia/Tokyo",
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.html;
};

describe("subscription_renewed", () => {
  it("names the plan, the price paid, and the new period in the tenant's time zone", async () => {
    const html = await render("en");

    expect(html).toContain("Your subscription has been renewed");
    expect(html).toContain(
      "Your subscription to All you can read has been renewed."
    );
    expect(html).toContain("Plan: All you can read");
    expect(html).toContain("Price paid: ¥980 (JPY)");
    expect(html).toContain(
      "Period paid for: Apr 2, 2026, 9:00 AM to May 2, 2026, 9:00 AM"
    );
    expect(html).toContain(
      "You can now read the episodes the plan covers until May 2, 2026, 9:00 AM. The plan then renews again automatically unless you cancel it."
    );
    expect(html).not.toContain("has started");
    expect(html).not.toContain("test mode");
    expect(html).not.toContain("Publira");
  });

  it("sends the reader to My Page, where Manage billing is", async () => {
    const html = await render("en");

    expect(html).toContain(
      "To update your card, read your invoices, or cancel, choose Manage billing on My Page."
    );
    expect(html).toContain("Open My Page");
    expect(html).toContain('href="https://aoto.example.com/my"');
  });

  it("says a renewal in the provider's test mode charged nothing", async () => {
    const html = await render("en", { is_test: true });

    expect(html).toContain(
      "This subscription was renewed in the payment provider"
    );
    expect(html).toContain("No money was charged.");
  });

  it("refuses the data the started mail would refuse", async () => {
    const result = await renderEmail({
      data: { ...data, amount: 0 },
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "subscription_renewed",
      timeZone: "Asia/Tokyo",
    });

    expect(result.ok).toBe(false);
  });

  it("the ja mail comes from the Japanese catalog", async () => {
    const html = await render("ja");

    expect(html).toContain("プランが更新されました");
    expect(html).toContain("プラン「All you can read」");
    expect(html).toContain("お支払い金額は￥980 (JPY) です。");
    expect(html).toContain(
      "お支払いの対象期間は2026/04/02 9:00から2026/05/02 9:00までです。"
    );
    expect(html).toContain(
      "2026/05/02 9:00まで、このプランの対象のエピソードを読めます。解約しない限り、その時点でプランは再び自動で更新されます。"
    );
  });
});
