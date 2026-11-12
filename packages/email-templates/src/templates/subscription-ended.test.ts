import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { loadEmailMessages } from "../messages";
import { renderEmail } from "../render";
import type { subscriptionEndedDataSchema } from "./subscription-ended";

// A monthly plan whose subscription ended at the end of its period, on 2 May.
const data = {
  ended_at: "2026-05-02T00:00:00Z",
  plan_name: "All you can read",
  plans_url: "https://aoto.example.com/plans",
  tenant_name: "Aoto Press",
} as const;

const render = async (
  locale: "en" | "ja",
  overrides: Partial<z.input<typeof subscriptionEndedDataSchema>> = {}
) => {
  const result = await renderEmail({
    data: { ...data, ...overrides },
    locale,
    messages: await loadEmailMessages(locale),
    template: "subscription_ended",
    timeZone: "Asia/Tokyo",
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  return result.html;
};

describe("subscription_ended", () => {
  it("names the plan and when it ended", async () => {
    const html = await render("en");

    expect(html).toContain("Your subscription has ended");
    expect(html).toContain("Your subscription to All you can read has ended.");
    expect(html).toContain(
      "Your subscription on Aoto Press is over, and you will not be charged for it again."
    );
    expect(html).toContain("Plan: All you can read");
    expect(html).toContain(
      "The subscription ended on May 2, 2026, 9:00 AM, and the episodes the plan covers are no longer open to you."
    );
    expect(html).not.toContain("Publira");
  });

  it("sends the reader to the site's plans to subscribe again", async () => {
    const html = await render("en");

    expect(html).toContain(
      "To read them again, choose a plan on the subscription plans page."
    );
    expect(html).toContain("See plans");
    expect(html).toContain('href="https://aoto.example.com/plans"');
  });

  it.each([
    { name: "an end that is no instant", overrides: { ended_at: "soon" } },
    { name: "a plans link that is no URL", overrides: { plans_url: "plans" } },
  ])("refuses $name", async ({ overrides }) => {
    const result = await renderEmail({
      data: { ...data, ...overrides },
      locale: "en",
      messages: await loadEmailMessages("en"),
      template: "subscription_ended",
      timeZone: "Asia/Tokyo",
    });

    expect(result.ok).toBe(false);
  });

  it("the ja mail comes from the Japanese catalog", async () => {
    const html = await render("ja");

    expect(html).toContain("プランのご利用が終了しました");
    expect(html).toContain("プラン「All you can read」");
    expect(html).toContain(
      "ご利用は2026/05/02 9:00に終了し、このプランの対象のエピソードは読めなくなりました。"
    );
    expect(html).toContain("プランを見る");
  });
});
