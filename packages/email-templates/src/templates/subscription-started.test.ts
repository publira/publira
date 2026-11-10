import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import type { subscriptionPaymentDataSchema } from "./subscription-payment";

// A ¥980 monthly plan whose first month runs from 2 March to 2 April.
const data = {
  amount: 980,
  currency: "JPY",
  is_test: false,
  my_page_url: "https://aoto.example.com/my",
  period_end: "2026-04-02T00:00:00Z",
  period_start: "2026-03-02T00:00:00Z",
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
    template: "subscription_started",
    timeZone: "Asia/Tokyo",
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.html;
};

describe("subscription_started", () => {
  it("names the plan, the price paid, and the period it covers in the tenant's time zone", async () => {
    const html = await render("en");

    expect(html).toContain("Your subscription has started");
    expect(html).toContain(
      "Your subscription to All you can read has started."
    );
    expect(html).toContain("Plan: All you can read");
    expect(html).toContain("Price paid: ¥980 (JPY)");
    expect(html).toContain(
      "Period paid for: Mar 2, 2026, 9:00 AM to Apr 2, 2026, 9:00 AM"
    );
    expect(html).toContain(
      "You can read the episodes the plan covers until Apr 2, 2026, 9:00 AM. The plan then renews automatically unless you cancel it."
    );
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

  it("says a subscription in the provider's test mode charged nothing", async () => {
    const html = await render("en", { is_test: true });

    expect(html).toContain("test mode. No money was charged.");
  });

  it("the ja mail comes from the Japanese catalog", async () => {
    const html = await render("ja");

    expect(html).toContain("プランのご利用が始まりました");
    expect(html).toContain("プラン「All you can read」");
    expect(html).toContain("お支払い金額は￥980 (JPY) です。");
    expect(html).toContain(
      "お支払いの対象期間は2026/03/02 9:00から2026/04/02 9:00までです。"
    );
    expect(html).toContain(
      "カードの変更、請求書の確認、解約は、マイページの「支払いの管理」から行えます。"
    );
  });
});
