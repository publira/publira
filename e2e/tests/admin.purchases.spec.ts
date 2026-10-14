import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import {
  PURCHASES,
  PURCHASES_ADMIN,
  PURCHASES_EPISODES,
  PURCHASES_READERS,
  PURCHASES_SCENARIO,
  PURCHASES_SERIES,
} from "../src/scenarios/purchases";
import { WEB_ADMIN_PURCHASES_BASE_URL } from "../src/urls";

/**
 * A tenant administrator finding a reader's purchase at `/purchases`, reading
 * it in the detail drawer, and being asked for a reason before refunding it.
 *
 * The refund itself is not submitted: it is a request to Stripe, which the
 * stack has no stand-in for. What the console sends with it is covered by the
 * Action's and the server's own tests.
 */

const PURCHASES_PATH = "/purchases";

const signIn = (page: Page, path = PURCHASES_PATH) =>
  signInAsAdmin(page, PURCHASES_ADMIN, path, WEB_ADMIN_PURCHASES_BASE_URL);

const rows = (page: Page) => page.getByRole("table").getByRole("row");

const drawer = (page: Page) => page.getByRole("dialog", { name: "Purchase" });

/** Takes the tenant's payments through Stripe, which makes a Stripe purchase refundable. */
const takePaymentsThroughStripe = async (page: Page) => {
  await page.goto(
    new URL("/integrations/payment", WEB_ADMIN_PURCHASES_BASE_URL).toString()
  );
  const provider = page.getByRole("combobox", { name: "Payment provider" });
  await provider.click();
  await page.getByRole("option", { name: "Stripe" }).click();
  await expect(provider).toContainText("Stripe");

  await page.getByRole("checkbox", { name: "Enable payments" }).click();
  await page.getByLabel(/^Secret key/u).fill("sk_test_placeholder");
  await page.getByLabel(/^Webhook signing secret/u).fill("whsec_placeholder");
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(
    page.getByText("The payment settings were saved.")
  ).toBeVisible();
};

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  applyScenarioSql(PURCHASES_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(PURCHASES_SCENARIO);
});

test.describe("Purchases", () => {
  test("lists the tenant's purchases newest first and narrows them", async ({
    page,
  }) => {
    await signIn(page);
    await expect(
      page.getByRole("heading", { exact: true, name: "Purchases" })
    ).toBeVisible();

    // The header row, then one row per purchase.
    await expect(rows(page)).toHaveCount(4);
    await expect(rows(page).nth(1)).toContainText(PURCHASES_READERS.one.name);
    await expect(rows(page).nth(1)).toContainText("Stripe");
    await expect(rows(page).nth(1)).toContainText("Active");
    await expect(rows(page).nth(2)).toContainText("Google Play");
    await expect(rows(page).nth(3)).toContainText("Refunded");

    await page
      .getByLabel("Reader's email address")
      .fill(PURCHASES_READERS.two.email);
    await page.getByRole("button", { exact: true, name: "Apply" }).click();
    await expect(page).toHaveURL(/email=purchase-buyer-two%40example\.com/u);
    await expect(rows(page)).toHaveCount(3);
    await expect(page.getByRole("table")).not.toContainText(
      PURCHASES_READERS.one.name
    );

    await page
      .getByLabel("Episode public_id")
      .fill(PURCHASES_EPISODES.second.publicId);
    await page.getByRole("button", { exact: true, name: "Apply" }).click();
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).nth(1)).toContainText(
      PURCHASES_EPISODES.second.title
    );

    // Reset is a link back to the screen, which drops every filter.
    await page.getByRole("link", { exact: true, name: "Reset" }).click();
    await expect(page).toHaveURL(/\/purchases$/u);
    await expect(rows(page)).toHaveCount(4);

    await page.getByLabel("Series public_id").fill(PURCHASES_SERIES.publicId);
    await page.getByLabel("From").fill(PURCHASES.googlePlay.purchasedOn);
    await page.getByLabel("To").fill(PURCHASES.stripe.purchasedOn);
    await page.getByRole("button", { exact: true, name: "Apply" }).click();
    await expect(rows(page)).toHaveCount(3);
    await expect(page.getByRole("table")).not.toContainText("Refunded");

    await page.getByLabel("From").fill(PURCHASES.stripe.purchasedOn);
    await page.getByLabel("To").fill(PURCHASES.googlePlay.purchasedOn);
    await page.getByRole("button", { exact: true, name: "Apply" }).click();
    await expect(
      page.getByText(
        "The period ends before it starts. Choose a To date on or after the From date."
      )
    ).toBeVisible();
  });

  test("opens a purchase in the drawer and closes it back to the list", async ({
    page,
  }) => {
    await signIn(page);

    await page
      .getByRole("link", {
        name: `View the purchase of ${PURCHASES_EPISODES.second.title} by ${PURCHASES_READERS.two.name}`,
      })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`purchase=${PURCHASES.googlePlay.id}`, "u")
    );
    await expect(drawer(page)).toContainText(PURCHASES.googlePlay.id);
    await expect(drawer(page)).toContainText(
      "A purchase in the app is refunded by Apple or Google, not here."
    );
    await expect(
      drawer(page).getByRole("button", { exact: true, name: "Refund" })
    ).toHaveCount(0);

    await drawer(page).getByRole("button", { name: "Close" }).click();
    await expect(drawer(page)).toBeHidden();
    await expect(page).toHaveURL(/\/purchases$/u);

    // A link to a purchase opens the drawer on its own, whatever the page.
    await page.goto(
      new URL(
        `${PURCHASES_PATH}?purchase=${PURCHASES.refunded.id}`,
        WEB_ADMIN_PURCHASES_BASE_URL
      ).toString()
    );
    await expect(drawer(page)).toContainText("Refunded");
    await expect(drawer(page)).toContainText(
      "Refunded through the payment provider"
    );
  });

  test("asks for a reason before it refunds a purchase", async ({ page }) => {
    await signIn(page, "/integrations/payment");

    // While the tenant takes no payments through Stripe, a Stripe purchase
    // cannot be refunded from the console.
    await page.goto(
      new URL(
        `${PURCHASES_PATH}?purchase=${PURCHASES.stripe.id}`,
        WEB_ADMIN_PURCHASES_BASE_URL
      ).toString()
    );
    await expect(drawer(page)).toContainText(
      "The tenant does not take payments through this provider now"
    );

    await takePaymentsThroughStripe(page);
    await page.goto(
      new URL(
        `${PURCHASES_PATH}?purchase=${PURCHASES.stripe.id}`,
        WEB_ADMIN_PURCHASES_BASE_URL
      ).toString()
    );
    await drawer(page)
      .getByRole("button", { exact: true, name: "Refund" })
      .click();

    const confirmation = page.getByRole("dialog", {
      name: "Refund this purchase?",
    });
    const confirm = confirmation.getByRole("button", {
      exact: true,
      name: "Refund",
    });
    await expect(confirm).toBeDisabled();

    const reason = confirmation.getByRole("textbox", { name: /Reason/u });
    await reason.fill("   ");
    await expect(confirm).toBeDisabled();
    await reason.fill("The reader bought the episode twice by mistake.");
    await expect(confirm).toBeEnabled();

    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).toBeHidden();
    await expect(drawer(page)).toContainText("Active");
  });
});
