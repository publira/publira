import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, runSql } from "../src/db";
import { uploadEpisodePages } from "../src/episode-pages";
import {
  STOREFRONT_SUBSCRIPTIONS_ADMIN,
  STOREFRONT_SUBSCRIPTIONS_EPISODE,
  STOREFRONT_SUBSCRIPTIONS_LABEL,
  STOREFRONT_SUBSCRIPTIONS_OTHER_EPISODE,
  STOREFRONT_SUBSCRIPTIONS_PLAN,
  STOREFRONT_SUBSCRIPTIONS_READER,
  STOREFRONT_SUBSCRIPTIONS_SCENARIO,
  STOREFRONT_SUBSCRIPTIONS_SERIES,
} from "../src/scenarios/storefront-subscriptions";
import { episodePageLabel } from "../src/scenarios/viewer-pages";
import { signInAsMember } from "../src/storefront";
import { createStripePrice, registerStripeWebhook } from "../src/stripe";
import {
  STRIPE_BASE_URL,
  WEB_ADMIN_SUBSCRIPTIONS_BASE_URL,
  WEB_STOREFRONT_SUBSCRIPTIONS_BASE_URL,
} from "../src/urls";

/**
 * A reader subscribing to a plan of a label through Stripe Checkout, against
 * the stack's stand-in for Stripe: they find the plan at the gate of an
 * episode it opens, leave the checkout once and pay it the second time, read
 * the episode, find the plan on My Page, and open the billing portal from
 * there.
 */

const episodePath = `/series/${STOREFRONT_SUBSCRIPTIONS_SERIES.publicId}/episodes/${STOREFRONT_SUBSCRIPTIONS_EPISODE.publicId}`;
const otherEpisodePath = `/series/${STOREFRONT_SUBSCRIPTIONS_OTHER_EPISODE.seriesPublicId}/episodes/${STOREFRONT_SUBSCRIPTIONS_OTHER_EPISODE.publicId}`;

const storefrontUrl = (path: string) =>
  new URL(path, WEB_STOREFRONT_SUBSCRIPTIONS_BASE_URL).toString();

/** Whether `url` is the tenant's site at `path`. */
const onSite = (url: URL, path: string) =>
  url.origin === new URL(WEB_STOREFRONT_SUBSCRIPTIONS_BASE_URL).origin &&
  url.pathname.endsWith(path);

/**
 * Takes the tenant's payments through Stripe and answers the secret key it
 * stored. The webhook URL the console shows is registered with the stand-in
 * under that key, and the key is a new one each run, a test account of its
 * own, for the reason `storefront.checkout.spec.ts` gives.
 */
const takePaymentsThroughStripe = async (page: Page): Promise<string> => {
  await signInAsAdmin(
    page,
    STOREFRONT_SUBSCRIPTIONS_ADMIN,
    "/integrations/payment",
    WEB_ADMIN_SUBSCRIPTIONS_BASE_URL
  );
  const provider = page.getByRole("combobox", { name: "Payment provider" });
  await provider.click();
  await page.getByRole("option", { name: "Stripe" }).click();
  await expect(provider).toContainText("Stripe");

  await page.getByRole("checkbox", { name: "Enable payments" }).click();
  const secretKey = `sk_test_${randomUUID().replaceAll("-", "")}`;
  await page.getByLabel(/^Secret key/u).fill(secretKey);
  const webhookSecret = await registerStripeWebhook(
    secretKey,
    await page.getByLabel("Webhook URL").inputValue()
  );
  await page.getByLabel(/^Webhook signing secret/u).fill(webhookSecret);
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(
    page.getByText("The payment settings were saved.")
  ).toBeVisible();
  return secretKey;
};

const subscribeLink = (page: Page) =>
  page.getByRole("link", { exact: true, name: "Subscribe" });

const planCard = (page: Page) =>
  page.getByRole("listitem").filter({
    has: page.getByRole("heading", {
      name: STOREFRONT_SUBSCRIPTIONS_PLAN.name,
    }),
  });

/** The stand-in's checkout page, headed by the plan's product and its price. */
const expectCheckout = async (page: Page) => {
  await page.waitForURL(`${STRIPE_BASE_URL}/checkout/**`);
  await expect(
    page.getByRole("heading", { name: STOREFRONT_SUBSCRIPTIONS_PLAN.name })
  ).toBeVisible();
  await expect(page.getByText("¥980", { exact: true })).toBeVisible();
};

const planSection = (page: Page) =>
  page.getByRole("region", { name: "Your plan" });

test.describe.configure({ mode: "serial" });

test.describe("web-storefront subscriptions", () => {
  test.beforeAll(async ({ browser }) => {
    applyScenarioSql(STOREFRONT_SUBSCRIPTIONS_SCENARIO);
    // The pages are what proves the subscription opened the episode.
    uploadEpisodePages(STOREFRONT_SUBSCRIPTIONS_EPISODE.publicId);

    const page = await browser.newPage();
    try {
      const secretKey = await takePaymentsThroughStripe(page);
      const priceId = await createStripePrice(secretKey, {
        amount: 980,
        currency: "jpy",
        interval: "month",
        name: STOREFRONT_SUBSCRIPTIONS_PLAN.name,
      });
      // The plan bills the Price this run's account holds, which the
      // scenario cannot name ahead of the run.
      runSql(
        `UPDATE subscription_plans SET stripe_price_id = '${priceId}' WHERE public_id = '${STOREFRONT_SUBSCRIPTIONS_PLAN.publicId}'`
      );
    } finally {
      await page.close();
    }
  });

  test.afterAll(() => {
    applyScenarioSql(STOREFRONT_SUBSCRIPTIONS_SCENARIO);
  });

  test("a reader subscribes from the gate of an episode the plan opens and reads it", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      STOREFRONT_SUBSCRIPTIONS_READER,
      otherEpisodePath,
      WEB_STOREFRONT_SUBSCRIPTIONS_BASE_URL
    );
    // The plan opens the label, and this series is filed under none.
    await expect(page.getByText("You cannot read this episode")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Buy this episode" })
    ).toBeVisible();
    await expect(subscribeLink(page)).toHaveCount(0);

    await page.goto(storefrontUrl(episodePath));
    await expect(page.getByText("You cannot read this episode")).toBeVisible();
    await subscribeLink(page).click();

    await page.waitForURL((url) => onSite(url, "/plans"));
    const card = planCard(page);
    await expect(card.getByText("¥980 a month")).toBeVisible();
    await expect(
      card.getByText("Covers the works of these labels:")
    ).toBeVisible();
    await expect(
      card.getByRole("link", { name: STOREFRONT_SUBSCRIPTIONS_LABEL.name })
    ).toBeVisible();

    // Leaving the checkout brings the reader back to the plans, charged
    // nothing.
    await card.getByRole("button", { name: "Subscribe" }).click();
    await expectCheckout(page);
    await page.getByRole("link", { name: "Cancel" }).click();
    await page.waitForURL(
      (url) =>
        onSite(url, "/plans") &&
        url.searchParams.get("subscription") === "cancelled"
    );
    await expect(
      page.getByText(
        "The subscription was cancelled. You have not been charged."
      )
    ).toBeVisible();

    // The checkout they left is still the one they pay.
    await planCard(page).getByRole("button", { name: "Subscribe" }).click();
    await expectCheckout(page);
    await page.getByRole("button", { name: "Pay" }).click();

    await page.waitForURL(
      (url) =>
        onSite(url, "/my") && url.searchParams.get("subscription") === "success"
    );
    await expect(
      page.getByText(
        "Thank you for subscribing. Your plan appears here once the payment is confirmed."
      )
    ).toBeVisible();
    // The stand-in delivers the webhook before it sends the reader back, so
    // the plan is recorded by the time My Page reads it.
    await expect(
      planSection(page).getByText(STOREFRONT_SUBSCRIPTIONS_PLAN.name)
    ).toBeVisible();
    await expect(planSection(page).getByText(/^Renews on /u)).toBeVisible();

    await page.goto(storefrontUrl(episodePath));
    await expect(
      page.locator(
        `canvas[aria-label="${episodePageLabel(STOREFRONT_SUBSCRIPTIONS_EPISODE.title, 1)}"]`
      )
    ).toBeVisible();
    await expect(page.getByText("You cannot read this episode")).toHaveCount(0);

    // One reader holds one plan, so the plan page offers no second one.
    await page.goto(storefrontUrl("/plans"));
    await expect(
      page.getByText(
        `You are subscribed to ${STOREFRONT_SUBSCRIPTIONS_PLAN.name}.`
      )
    ).toBeVisible();
    await expect(
      planCard(page).getByRole("button", { name: "Subscribe" })
    ).toHaveCount(0);
  });

  test("the subscriber opens the billing portal from My Page and comes back", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      STOREFRONT_SUBSCRIPTIONS_READER,
      "/my",
      WEB_STOREFRONT_SUBSCRIPTIONS_BASE_URL
    );
    await planSection(page)
      .getByRole("button", { name: "Manage billing" })
      .click();

    await page.waitForURL(`${STRIPE_BASE_URL}/billing/**`);
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await page.getByRole("link", { name: "Return to the site" }).click();

    await page.waitForURL((url) => onSite(url, "/my"));
    await expect(
      planSection(page).getByText(STOREFRONT_SUBSCRIPTIONS_PLAN.name)
    ).toBeVisible();
  });
});
