import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import { uploadEpisodePages } from "../src/episode-pages";
import { formMessage, signInAsPlatformOperator } from "../src/platform";
import {
  revalidatePlatformTags,
  revalidateStorefrontTags,
} from "../src/revalidate";
import {
  PLATFORM_TENANT_COINS_OPERATOR,
  PLATFORM_TENANT_COINS_SCENARIO,
} from "../src/scenarios/platform-tenant-coins";
import {
  STOREFRONT_COINS_ADMIN,
  STOREFRONT_COINS_BUYER,
  STOREFRONT_COINS_COVERING_PACK,
  STOREFRONT_COINS_EPISODE,
  STOREFRONT_COINS_HOLDER,
  STOREFRONT_COINS_ISSUER,
  STOREFRONT_COINS_NAME,
  STOREFRONT_COINS_OFF_EPISODE,
  STOREFRONT_COINS_OFF_READER,
  STOREFRONT_COINS_OTHER_EPISODE,
  STOREFRONT_COINS_SCENARIO,
  STOREFRONT_COINS_SERIES,
  STOREFRONT_COINS_TENANT_ID,
} from "../src/scenarios/storefront-coins";
import { episodePageLabel } from "../src/scenarios/viewer-pages";
import { signInAsMember } from "../src/storefront";
import { registerStripeWebhook } from "../src/stripe";
import {
  STRIPE_BASE_URL,
  WEB_ADMIN_COINS_BASE_URL,
  WEB_STOREFRONT_COINS_BASE_URL,
  WEB_STOREFRONT_COINS_OFF_BASE_URL,
} from "../src/urls";

/**
 * Readers paying for episodes with the tenant's coins, which the tenant calls
 * Points in English and ポイント in Japanese, against the stack's stand-in for
 * Stripe: one reader pays with the Points they hold without leaving the
 * episode, another buys the pack that covers the price at the gate, comes back
 * to the episode, and pays with its Points, and both find their balance, the
 * packs, and the history under the tenant's word. A tenant whose coins are off
 * shows its gate and its account as they are without them.
 */

const episodePath = `/series/${STOREFRONT_COINS_SERIES.publicId}/episodes/${STOREFRONT_COINS_EPISODE.publicId}`;
const otherEpisodePath = `/series/${STOREFRONT_COINS_SERIES.publicId}/episodes/${STOREFRONT_COINS_OTHER_EPISODE.publicId}`;
const offEpisodePath = `/series/${STOREFRONT_COINS_OFF_EPISODE.seriesPublicId}/episodes/${STOREFRONT_COINS_OFF_EPISODE.publicId}`;

const storefrontUrl = (path: string, baseUrl = WEB_STOREFRONT_COINS_BASE_URL) =>
  new URL(path, baseUrl).toString();

/** Whether `url` is the coins tenant's site at `path`. */
const onSite = (url: URL, path: string) =>
  url.origin === new URL(WEB_STOREFRONT_COINS_BASE_URL).origin &&
  url.pathname.endsWith(path);

/** The word a reader-facing screen must never use where the tenant's belongs. */
const COINS_WORD = /\bcoins?\b/iu;

/**
 * The text a reader can be shown, without the structured data and the
 * streaming scripts a page carries, whose URLs name the tenant's host.
 */
const shownText = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const body = document.body.cloneNode(true) as HTMLElement;
    for (const element of body.querySelectorAll("script, style, template")) {
      element.remove();
    }
    return body.textContent ?? "";
  });

const gateTitle = (page: Page) =>
  page.getByText("You cannot read this episode");

const firstPage = (page: Page, episodeTitle: string) =>
  page.locator(`canvas[aria-label="${episodePageLabel(episodeTitle, 1)}"]`);

const payButton = (page: Page) =>
  page.getByRole("button", { name: "Pay 30 Points" });

const coveringPackButton = (page: Page) =>
  page.getByRole("button", { name: "Buy 50 Points for ¥500" });

const coinsSection = (page: Page) =>
  page.getByRole("region", { name: STOREFRONT_COINS_NAME.en });

/**
 * Lets tenants issue coins, or stops them, from the Platform Console's
 * Security page, as the operator `660_platform_tenant_coins.sql` seeds. Saving there writes the
 * policy row and owes every tenant's catalog a drop once the API's own cache
 * of the policy has run out.
 *
 * The scenario writes the policy row straight to Postgres, which leaves the
 * console holding the revision it read before, and the save of a stale
 * revision is refused. The console's policy tag is dropped first and the save
 * tried again until the form carries the revision that is stored.
 */
const setTenantCoinsAllowed = async (
  page: Page,
  allowed: boolean
): Promise<void> => {
  await signInAsPlatformOperator(
    page,
    PLATFORM_TENANT_COINS_OPERATOR,
    "/policies/security"
  );
  await expect(async () => {
    await revalidatePlatformTags(["platform:policy"]);
    await page.reload();
    await page
      .getByRole("checkbox", {
        exact: true,
        name: "Allow tenants to issue coins",
      })
      .setChecked(allowed);
    await page.getByRole("button", { name: "Save security policy" }).click();
    await expect(formMessage(page)).toContainText("Security policy saved.", {
      timeout: 5000,
    });
  }).toPass({ timeout: 60_000 });
};

/**
 * Takes the tenant's payments through Stripe, which is what sells its packs.
 * The secret key is a new one each run, a test account of its own, for the
 * reason `storefront.checkout.spec.ts` gives.
 */
const takePaymentsThroughStripe = async (page: Page): Promise<void> => {
  await signInAsAdmin(
    page,
    STOREFRONT_COINS_ADMIN,
    "/integrations/payment",
    WEB_ADMIN_COINS_BASE_URL
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
};

/**
 * Opens `path` until `ready` shows. The API reads the platform's allowance
 * through a cache of its own for a few seconds after the save, and an episode
 * the storefront read in that window is held without its price in coins until
 * the catalog's tag is dropped, so the suite drops it itself between tries.
 */
const openOnceCoinsShow = async (
  page: Page,
  path: string,
  ready: (page: Page) => Locator
): Promise<void> => {
  await expect(async () => {
    await revalidateStorefrontTags([
      `tenant:${STOREFRONT_COINS_TENANT_ID}:series:detail`,
    ]);
    await page.goto(storefrontUrl(path));
    await expect(ready(page)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
};

test.describe.configure({ mode: "serial" });

test.describe("web-storefront coins", () => {
  test.beforeAll(async ({ browser }) => {
    applyScenarioSql(STOREFRONT_COINS_SCENARIO);
    applyScenarioSql(PLATFORM_TENANT_COINS_SCENARIO);
    // The pages are what proves the coins opened each episode.
    uploadEpisodePages(STOREFRONT_COINS_EPISODE.publicId);
    uploadEpisodePages(STOREFRONT_COINS_OTHER_EPISODE.publicId);

    const page = await browser.newPage();
    try {
      await setTenantCoinsAllowed(page, true);
      await takePaymentsThroughStripe(page);
    } finally {
      await page.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    // Switches the platform's allowance off again, the value every other
    // suite expects, through the console, which then shows it off as well,
    // and puts both tenants back as they were.
    const page = await browser.newPage();
    try {
      await setTenantCoinsAllowed(page, false);
    } finally {
      await page.close();
    }
    applyScenarioSql(STOREFRONT_COINS_SCENARIO);
  });

  test("a reader with enough Points pays for an episode at its gate without leaving the page", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      STOREFRONT_COINS_HOLDER,
      episodePath,
      WEB_STOREFRONT_COINS_BASE_URL
    );
    await openOnceCoinsShow(page, episodePath, payButton);

    await expect(page.getByText("You have 100 Points.")).toBeVisible();
    // Paying with Points takes the Shu from the purchase, which stays beside it.
    await expect(
      page.getByRole("button", { name: "Buy this episode" })
    ).toBeVisible();
    expect(await shownText(page)).not.toMatch(COINS_WORD);

    await payButton(page).click();
    await expect(gateTitle(page)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(episodePath);
    await expect(firstPage(page, STOREFRONT_COINS_EPISODE.title)).toBeVisible();

    await page.goto(storefrontUrl("/my"));
    await expect(
      coinsSection(page).getByText("70 Points", { exact: true })
    ).toBeVisible();
    expect(await shownText(page)).not.toMatch(COINS_WORD);
    await coinsSection(page)
      .getByRole("link", { name: "Buy Points and see your history" })
      .click();

    await page.waitForURL((url) => onSite(url, "/my/coins"));
    await expect(
      page.getByRole("heading", { level: 1, name: STOREFRONT_COINS_NAME.en })
    ).toBeVisible();
    const history = page.getByRole("region", { name: "History" });
    await expect(history.getByText("Spent on an episode")).toBeVisible();
    await expect(history.getByText("−30 Points")).toBeVisible();
    await expect(
      history.getByRole("link", {
        name: `#1 ${STOREFRONT_COINS_EPISODE.title}`,
      })
    ).toBeVisible();
    await expect(history.getByText("+100 Points")).toBeVisible();
    const packs = page.getByRole("region", { name: "Buy Points" });
    await expect(
      packs.getByRole("heading", { name: "100 Points (including 20 bonus)" })
    ).toBeVisible();
    await expect(
      packs
        .getByText("These Points can be spent for 180 days after purchase.")
        .first()
    ).toBeVisible();
    await expect(packs.getByText(STOREFRONT_COINS_ISSUER)).toBeVisible();
    await expect(
      packs.getByRole("link", { name: "Read the terms" })
    ).toHaveAttribute("href", "https://example.com/points-terms");
    expect(await shownText(page)).not.toMatch(COINS_WORD);

    // The purchase is listed with the Points it took in place of a price.
    await page.goto(storefrontUrl("/my/library"));
    await expect(page.getByText("30 Points", { exact: true })).toBeVisible();
  });

  test("a reader short of Points buys the pack that covers it at the gate and comes back to pay", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      STOREFRONT_COINS_BUYER,
      otherEpisodePath,
      WEB_STOREFRONT_COINS_BASE_URL
    );
    await openOnceCoinsShow(page, otherEpisodePath, coveringPackButton);

    await expect(
      page.getByText(
        "This episode costs 30 Points, and you have 0. Buy at least 30 more to pay with them."
      )
    ).toBeVisible();
    await expect(
      page.getByText("These Points can be spent for 180 days after purchase.")
    ).toBeVisible();
    await expect(page.getByText(STOREFRONT_COINS_ISSUER)).toBeVisible();
    await expect(payButton(page)).toHaveCount(0);

    await coveringPackButton(page).click();
    await page.waitForURL(`${STRIPE_BASE_URL}/checkout/**`);
    await expect(
      page.getByRole("heading", {
        name: `${STOREFRONT_COINS_COVERING_PACK.coins} Points`,
      })
    ).toBeVisible();
    await expect(page.getByText("¥500", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Pay" }).click();

    // The stand-in delivers the webhook before it sends the reader back, so
    // the pack's Points are granted by the time the episode reads the balance.
    await page.waitForURL(
      (url) =>
        onSite(url, otherEpisodePath) &&
        url.searchParams.get("checkout") === "success" &&
        url.searchParams.get("coin_pack") ===
          STOREFRONT_COINS_COVERING_PACK.publicId
    );
    await expect(
      page.getByText(
        "Thank you. Your Points are added once the payment is confirmed, and you can then pay for this episode with them."
      )
    ).toBeVisible();
    await expect(page.getByText("You have 50 Points.")).toBeVisible();

    await payButton(page).click();
    await expect(gateTitle(page)).toHaveCount(0);
    await expect(
      firstPage(page, STOREFRONT_COINS_OTHER_EPISODE.title)
    ).toBeVisible();

    await page.goto(storefrontUrl("/my/coins"));
    await expect(
      page
        .getByRole("region", { name: "Balance" })
        .getByText("20 Points", { exact: true })
    ).toBeVisible();
    const history = page.getByRole("region", { name: "History" });
    await expect(history.getByText("+50 Points")).toBeVisible();
    await expect(history.getByText("−30 Points")).toBeVisible();
  });

  test("a reader in Japanese sees the tenant's Japanese word for its coins", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      STOREFRONT_COINS_HOLDER,
      "/ja/my/coins",
      WEB_STOREFRONT_COINS_BASE_URL
    );
    await page.goto(storefrontUrl("/ja/my/coins"));

    await expect(
      page.getByRole("heading", { level: 1, name: STOREFRONT_COINS_NAME.ja })
    ).toBeVisible();
    await expect(page.getByText("70ポイント", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "ポイントを購入" })
    ).toBeVisible();
    const text = await shownText(page);
    expect(text).not.toContain(STOREFRONT_COINS_NAME.en);
    expect(text).not.toMatch(COINS_WORD);
  });

  test("a tenant whose coins are off shows its gate and its account as they are without them", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      STOREFRONT_COINS_OFF_READER,
      offEpisodePath,
      WEB_STOREFRONT_COINS_OFF_BASE_URL
    );
    await page.goto(
      storefrontUrl(offEpisodePath, WEB_STOREFRONT_COINS_OFF_BASE_URL)
    );

    await expect(gateTitle(page)).toBeVisible();
    // The tenant takes no payments, so the gate says what it says for any
    // episode the site cannot sell, and offers nothing for coins.
    await expect(
      page.getByText(
        "This site cannot take purchases at the moment. Check whether your ticket has expired or has not been granted yet."
      )
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Points/u })).toHaveCount(0);
    expect(await shownText(page)).not.toContain("Points");

    await page.goto(storefrontUrl("/my", WEB_STOREFRONT_COINS_OFF_BASE_URL));
    await expect(
      page.getByRole("heading", { level: 1, name: "My Page" })
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Points" })).toHaveCount(0);
    expect(await shownText(page)).not.toContain("Points");

    await page.goto(
      storefrontUrl("/my/coins", WEB_STOREFRONT_COINS_OFF_BASE_URL)
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" })
    ).toBeVisible();
  });
});
