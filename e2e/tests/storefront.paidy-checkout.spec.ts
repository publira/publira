import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql, quoteSqlLiteral } from "../src/db";
import { uploadEpisodePages } from "../src/episode-pages";
import { routePaidyCheckout } from "../src/paidy";
import {
  PAIDY_CHECKOUT_ADMIN,
  PAIDY_CHECKOUT_EPISODE,
  PAIDY_CHECKOUT_EPISODE_PATH,
  PAIDY_CHECKOUT_READERS,
  PAIDY_CHECKOUT_SCENARIO,
} from "../src/scenarios/paidy-checkout";
import { episodePageLabel } from "../src/scenarios/viewer-pages";
import { signInAsMember } from "../src/storefront";
import {
  WEB_ADMIN_PAIDY_BASE_URL,
  WEB_STOREFRONT_PAIDY_BASE_URL,
} from "../src/urls";

/**
 * Readers buying an episode through Paidy, against the stack's stand-in for
 * Paidy and its fake of Paidy Checkout: the gate sends each reader to the
 * storefront's payment page, which asks for the name and the billing address
 * and opens Paidy Checkout. One reader authorizes the payment there, which
 * the page hands to publira server, which captures it at the stand-in, and
 * comes back to the episode open; another closes Paidy Checkout and comes back
 * to the episode's cancel page with nothing bought.
 */

/**
 * Takes the tenant's payments through Paidy, which is what lets the gate
 * sell. The keys are a new pair each run, an account of their own at the
 * stand-in, and live ones, so the purchase is a sale.
 */
const takePaymentsThroughPaidy = async (page: Page) => {
  await signInAsAdmin(
    page,
    PAIDY_CHECKOUT_ADMIN,
    "/integrations/payment",
    WEB_ADMIN_PAIDY_BASE_URL
  );
  const provider = page.getByRole("combobox", { name: "Payment provider" });
  await provider.click();
  await page.getByRole("option", { name: "Paidy" }).click();
  await expect(provider).toContainText("Paidy");

  await page.getByRole("checkbox", { name: "Enable payments" }).click();
  const account = `live_${randomUUID().replaceAll("-", "")}`;
  await page.getByLabel(/^Public key/u).fill(`pk_${account}`);
  await page.getByLabel(/^Secret key/u).fill(`sk_${account}`);
  await page.getByRole("button", { exact: true, name: "Add provider" }).click();
  await expect(page.getByText("Paidy was added.")).toBeVisible();
};

/**
 * Buy the episode at its gate, fill in the payment page, and open Paidy
 * Checkout, which names what the checkout charges.
 */
const openPaidyCheckout = async (page: Page) => {
  await expect(page.getByText("You cannot read this episode")).toBeVisible();
  await page.getByRole("button", { name: "Buy this episode" }).click();

  await page.waitForURL(
    (url) =>
      url.origin === new URL(WEB_STOREFRONT_PAIDY_BASE_URL).origin &&
      url.pathname.includes("/pay/paidy/")
  );
  await page.getByLabel("Family name").fill("Yamada");
  await page.getByLabel("Given name").fill("Hanako");
  await page.getByLabel("Postal code").fill("100-0001");
  await page.getByLabel("Prefecture").fill("Tokyo");
  await page.getByLabel("City").fill("Chiyoda");
  await page.getByLabel("Street address").fill("1-1");
  await page.getByRole("button", { name: "Continue to payment" }).click();

  const checkout = page.getByRole("dialog", { name: "Paidy Checkout" });
  await expect(checkout.getByText("Amount: 500 JPY")).toBeVisible();
  await expect(checkout.getByText("Buyer: Yamada Hanako")).toBeVisible();

  return checkout;
};

/** Whether the episode's checkout came back to its page as `outcome`. */
const backOnEpisode = (outcome: "cancelled" | "success") => (url: URL) =>
  url.origin === new URL(WEB_STOREFRONT_PAIDY_BASE_URL).origin &&
  url.pathname.endsWith(PAIDY_CHECKOUT_EPISODE_PATH) &&
  url.searchParams.get("checkout") === outcome;

/** The purchases the reader `email` holds of the tenant. */
const purchasesOf = (email: string) =>
  Number(
    querySql(`
      SELECT COUNT(*)
      FROM purchases p
      JOIN users u ON u.id = p.user_id
      WHERE u.email = ${quoteSqlLiteral(email)}
        AND p.provider = 'paidy';
    `)
  );

test.describe.configure({ mode: "serial" });

test.describe("web-storefront Paidy checkout", () => {
  test.beforeAll(async ({ browser }) => {
    applyScenarioSql(PAIDY_CHECKOUT_SCENARIO);
    // The pages are what proves the checkout opened the episode.
    uploadEpisodePages(PAIDY_CHECKOUT_EPISODE.publicId);

    const page = await browser.newPage();

    try {
      await takePaymentsThroughPaidy(page);
    } finally {
      await page.close();
    }
  });

  test.afterAll(() => {
    applyScenarioSql(PAIDY_CHECKOUT_SCENARIO);
  });

  test("a reader who authorizes the payment in Paidy Checkout comes back to the episode open", async ({
    page,
  }) => {
    await routePaidyCheckout(page);
    await signInAsMember(
      page,
      PAIDY_CHECKOUT_READERS.payer,
      PAIDY_CHECKOUT_EPISODE_PATH,
      WEB_STOREFRONT_PAIDY_BASE_URL
    );

    const checkout = await openPaidyCheckout(page);
    await checkout.getByRole("button", { name: "Authorize" }).click();

    await page.waitForURL(backOnEpisode("success"));
    await expect(
      page.locator(
        `canvas[aria-label="${episodePageLabel(PAIDY_CHECKOUT_EPISODE.title, 1)}"]`
      )
    ).toBeVisible();
    await expect(page.getByText("You cannot read this episode")).toHaveCount(0);
    expect(purchasesOf(PAIDY_CHECKOUT_READERS.payer.email)).toBe(1);
  });

  test("a reader who closes Paidy Checkout comes back to the cancel page with nothing bought", async ({
    page,
  }) => {
    await routePaidyCheckout(page);
    await signInAsMember(
      page,
      PAIDY_CHECKOUT_READERS.leaver,
      PAIDY_CHECKOUT_EPISODE_PATH,
      WEB_STOREFRONT_PAIDY_BASE_URL
    );

    const checkout = await openPaidyCheckout(page);
    await checkout.getByRole("button", { name: "Close" }).click();

    await page.waitForURL(backOnEpisode("cancelled"));
    await expect(page.getByText("You cannot read this episode")).toBeVisible();
    expect(purchasesOf(PAIDY_CHECKOUT_READERS.leaver.email)).toBe(0);
  });
});
