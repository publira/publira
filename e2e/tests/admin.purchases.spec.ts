import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import {
  PURCHASES,
  PURCHASES_ADMIN,
  PURCHASES_EPISODES,
  PURCHASES_READERS,
  PURCHASES_RECONCILIATION,
  PURCHASES_SCENARIO,
  PURCHASES_SERIES,
  PURCHASES_TENANT,
} from "../src/scenarios/purchases";
import {
  registerStripePaymentIntent,
  registerStripeWebhook,
  reportStripeRefunds,
} from "../src/stripe";
import { WEB_ADMIN_PURCHASES_BASE_URL } from "../src/urls";

/**
 * A tenant administrator finding a reader's purchase at `/purchases`, reading
 * it in the detail drawer, downloading the purchases of a period, and
 * refunding it through the stack's stand-in for Stripe once they have given a
 * reason: part of the price first, and the rest once Stripe has reported that
 * part. Then reconciling a day at `/reconciliation` against what the
 * stand-in says Stripe was paid.
 */

const PURCHASES_PATH = "/purchases";
const RECONCILIATION_PATH = "/reconciliation";

const signIn = (page: Page, path = PURCHASES_PATH) =>
  signInAsAdmin(page, PURCHASES_ADMIN, path, WEB_ADMIN_PURCHASES_BASE_URL);

const rows = (page: Page) => page.getByRole("table").getByRole("row");

// The name is the whole title. A substring would also match the refund
// confirmation, "Refund this purchase?", while that dialog is still closing.
const drawer = (page: Page) =>
  page.getByRole("dialog", { exact: true, name: "Purchase" });

/**
 * Takes the tenant's payments through Stripe, which makes a Stripe purchase
 * refundable, has the stand-in hold the payment the Stripe purchase was seeded
 * with, and registers the webhook URL the console shows with the stand-in, as
 * an operator registers it in Stripe's dashboard, so that the refunds it
 * reports reach the install. Answers the secret key the stand-in knows the
 * account by.
 *
 * The key is a new one each run, a test account of its own: the stand-in
 * keeps what it refunded, and a run that starts over has seeded the purchase
 * again unrefunded under the same refund idempotency key.
 */
const takePaymentsThroughStripe = async (page: Page): Promise<string> => {
  const secretKey = `sk_test_${randomUUID().replaceAll("-", "")}`;
  await registerStripePaymentIntent(secretKey, PURCHASES.stripe.payment);

  await page.goto(
    new URL("/integrations/payment", WEB_ADMIN_PURCHASES_BASE_URL).toString()
  );
  const provider = page.getByRole("combobox", { name: "Payment provider" });
  await provider.click();
  await page.getByRole("option", { name: "Stripe" }).click();
  await expect(provider).toContainText("Stripe");

  await page.getByRole("checkbox", { name: "Enable payments" }).click();
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

/** The CSV header `ExportPurchases` writes. */
const PURCHASES_CSV_HEADER =
  "\uFEFFrow_type,purchase_id,occurred_at,purchased_at,amount,currency,kind,item_type,item_id,provider,provider_checkout_id,provider_payment_id,store,store_transaction_id,test";

const adminUrl = (path: string) =>
  new URL(path, WEB_ADMIN_PURCHASES_BASE_URL).toString();

/** Opens the purchase paid through Stripe in the drawer. */
const openStripePurchase = (page: Page) =>
  page.goto(
    new URL(
      `${PURCHASES_PATH}?purchase=${PURCHASES.stripe.id}`,
      WEB_ADMIN_PURCHASES_BASE_URL
    ).toString()
  );

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
    // Closing took the purchase out of the history, so going back does not
    // open it again.
    await page.goBack();
    await expect(page).toHaveURL(/\/purchases$/u);
    await expect(drawer(page)).toBeHidden();

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

  test("Download CSV saves the purchases of the period shown, and the download is in Audit logs", async ({
    page,
  }) => {
    const from = PURCHASES.googlePlay.purchasedOn;
    const to = PURCHASES.stripe.purchasedOn;

    await signIn(page, `${PURCHASES_PATH}?from=${from}&to=${to}`);
    await expect(rows(page)).toHaveCount(3);

    const downloading = page.waitForEvent("download");
    await page.getByRole("link", { exact: true, name: "Download CSV" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(
      `purchases-${PURCHASES_TENANT.publicId}-${from}--${to}.csv`
    );

    const csv = await readFile(await download.path(), "utf-8");
    const [header, ...lines] = csv.split("\r\n").filter((row) => row !== "");
    expect(header).toBe(PURCHASES_CSV_HEADER);
    // One row per purchase the list shows; the refund of the third purchase
    // is dated before the period.
    expect(
      lines.map((line) => line.split(",").slice(0, 2).join(",")).toSorted()
    ).toEqual(
      [
        `purchase,${PURCHASES.stripe.id}`,
        `purchase,${PURCHASES.googlePlay.id}`,
      ].toSorted()
    );
    expect(csv).toContain(PURCHASES.stripe.payment.id);

    // The download is an entry of the audit log, written by its asynchronous
    // recorder, so the read polls.
    const period = `${from}/${to}`;
    const entry = page.getByRole("row").filter({ hasText: period });
    await expect(async () => {
      await page.goto(adminUrl("/audit-logs?action=purchases_exported"));
      await expect(entry.first()).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30_000 });
    await expect(entry.first()).toContainText("Purchases CSV downloaded");
    await expect(entry.first()).toContainText(PURCHASES_ADMIN.name);
  });

  test("Download CSV is offered only for a period one file can cover", async ({
    page,
  }) => {
    await signIn(
      page,
      `${PURCHASES_PATH}?from=2024-01-01&to=${PURCHASES.stripe.purchasedOn}`
    );

    await expect(
      page.getByRole("link", { exact: true, name: "Download CSV" })
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "Download CSV covers at most 366 days, with From on or before To. Narrow the period to download it."
      )
    ).toBeVisible();

    // The file is the period's accounting, so the reader filter is not
    // applied to it, and the form says so.
    await page.goto(
      adminUrl(
        `${PURCHASES_PATH}?email=${encodeURIComponent(PURCHASES_READERS.two.email)}&from=${PURCHASES.googlePlay.purchasedOn}&to=${PURCHASES.stripe.purchasedOn}`
      )
    );
    await expect(
      page.getByRole("link", { exact: true, name: "Download CSV" })
    ).toHaveAttribute(
      "href",
      `/api/v1/purchases/csv?from=${PURCHASES.googlePlay.purchasedOn}&to=${PURCHASES.stripe.purchasedOn}`
    );
    await expect(
      page.getByText(
        "The file holds every purchase and refund of the period. The other filters are not applied to it."
      )
    ).toBeVisible();
  });

  test("refunds part of a purchase through Stripe, then the rest once Stripe reports it", async ({
    page,
  }) => {
    await signIn(page, "/integrations/payment");

    // While the tenant takes no payments through Stripe, a Stripe purchase
    // cannot be refunded from the console.
    await openStripePurchase(page);
    await expect(drawer(page)).toContainText(
      "The tenant does not take payments through this provider now"
    );

    const secretKey = await takePaymentsThroughStripe(page);
    await openStripePurchase(page);
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

    const amount = confirmation.getByRole("spinbutton", {
      name: /Amount to refund/u,
    });

    const reason = confirmation.getByRole("textbox", { name: /Reason/u });

    // The amount starts at all that is left, which closes the episode.
    await expect(amount).toHaveValue("500");
    await expect(confirmation).toContainText("Up to ¥500");
    await expect(confirmation).toContainText(
      "Refunding all of it closes what the reader bought to them at once."
    );
    await expect(confirm).toBeDisabled();

    await reason.fill("   ");
    await expect(confirm).toBeDisabled();
    await reason.fill("Half of the pages would not load.");
    await expect(confirm).toBeEnabled();

    await amount.fill("501");
    await expect(confirm).toBeDisabled();
    await expect(confirmation).toContainText(
      "Enter an amount above zero and no more than what is left to refund."
    );

    // Cancelling leaves the purchase as it was.
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).toBeHidden();
    await expect(drawer(page)).toContainText("Active");

    await drawer(page)
      .getByRole("button", { exact: true, name: "Refund" })
      .click();
    await amount.fill("200");
    await expect(confirmation).toContainText(
      "What the reader bought stays open to them."
    );
    await reason.fill("Half of the pages would not load.");
    await confirm.click();

    // Stripe accepted the refund in part, which leaves the episode open to
    // the reader and waits for Stripe's notification of it.
    await expect(
      page.getByText("A refund of ¥200 was requested.")
    ).toBeVisible();
    await expect(drawer(page)).toContainText("Refund requested");
    await expect(drawer(page).getByText("¥200", { exact: true })).toHaveCount(
      1
    );
    await expect(drawer(page)).toContainText(
      "A refund of part of the price was requested, and what the reader bought stays open to them."
    );
    await expect(drawer(page)).not.toContainText("Closed to the reader");

    // While it waits, the refund can only be asked again for that amount.
    await drawer(page)
      .getByRole("button", { exact: true, name: "Refund" })
      .click();
    await expect(amount).toHaveValue("200");
    await expect(amount).toHaveAttribute("readonly", "");
    await expect(confirmation).toContainText(
      "A refund of ¥200 is waiting for the payment provider."
    );
    await confirmation.getByRole("button", { name: "Cancel" }).click();

    await reportStripeRefunds(secretKey, PURCHASES.stripe.payment.id);
    await page.reload();
    await expect(drawer(page)).toContainText("Partly refunded");
    await expect(drawer(page)).not.toContainText("Refund requested");
    await expect(drawer(page).getByText("¥200", { exact: true })).toHaveCount(
      1
    );

    // The rest is what the dialog starts at now, and refunding it closes the
    // episode at once.
    await drawer(page)
      .getByRole("button", { exact: true, name: "Refund" })
      .click();
    await expect(amount).toHaveValue("300");
    await expect(confirmation).toContainText(
      "Refunding all of it closes what the reader bought to them at once."
    );
    await reason.fill("The reader asked for the rest back.");
    await confirm.click();

    await expect(
      page.getByText("A refund of ¥300 was requested.")
    ).toBeVisible();
    await expect(drawer(page)).toContainText("Refund requested");
    await expect(drawer(page)).toContainText("Refunded by staff");
    await expect(drawer(page)).toContainText(
      "The refund was requested, and what the reader bought is closed to them."
    );
    await expect(
      drawer(page).getByRole("button", { exact: true, name: "Refund" })
    ).toHaveCount(0);

    await reportStripeRefunds(secretKey, PURCHASES.stripe.payment.id);
    await page.reload();
    await expect(drawer(page)).not.toContainText("Refund requested");
    // What was paid, and as much refunded.
    await expect(drawer(page).getByText("¥500", { exact: true })).toHaveCount(
      2
    );

    await drawer(page).getByRole("button", { name: "Close" }).click();
    await expect(rows(page).nth(1)).toContainText(PURCHASES_READERS.one.name);
    await expect(rows(page).nth(1)).toContainText("Refunded");
  });
});

test.describe("Reconciliation", () => {
  test("reconciles a day against Stripe and lists each line that matches nothing", async ({
    page,
  }) => {
    // The refunds above changed the purchase this compares, so the tenant
    // starts over, without payment settings, and is signed in again.
    applyScenarioSql(PURCHASES_SCENARIO);
    await signIn(page, "/integrations/payment");

    const secretKey = await takePaymentsThroughStripe(page);
    await registerStripePaymentIntent(
      secretKey,
      PURCHASES_RECONCILIATION.short
    );
    await registerStripePaymentIntent(
      secretKey,
      PURCHASES_RECONCILIATION.unrecorded
    );

    await page.goto(adminUrl(RECONCILIATION_PATH));
    await expect(
      page.getByRole("heading", { exact: true, name: "Reconciliation" })
    ).toBeVisible();

    const { day } = PURCHASES_RECONCILIATION;
    await page.getByLabel("From").fill(day);
    await page.getByLabel("To").fill(day);
    await page.getByRole("button", { exact: true, name: "Reconcile" }).click();
    await expect(
      page.getByText(
        "A reconciliation was started against 1 source. The list below shows it once it finishes."
      )
    ).toBeVisible();

    // The worker takes the run up within seconds, and the screen refreshes
    // itself while the run is unfinished.
    const run = rows(page).filter({ hasText: "Stripe" });
    await expect(run).toHaveCount(1);
    await expect(run).toContainText("Finished", { timeout: 60_000 });

    await run
      .getByRole("link", { name: /^View the findings of Stripe/u })
      .click();

    const findings = page.getByRole("dialog", {
      exact: true,
      name: "Findings",
    });

    await expect(findings).toContainText(
      "Payments: 2 · Purchases: 1 · Matched: 1 · Findings: 2"
    );

    const lines = findings.getByRole("listitem");
    await expect(lines).toHaveCount(2);

    // The payment whose notification never arrived, named by its ID at
    // Stripe, with no purchase beside it.
    const unrecorded = lines.filter({ hasText: "Payment with no purchase" });
    await expect(unrecorded).toContainText(
      PURCHASES_RECONCILIATION.unrecorded.id
    );
    await expect(unrecorded).toContainText("¥300");
    await expect(
      unrecorded.getByRole("link", { name: "Open the purchase" })
    ).toHaveCount(0);

    // The purchase Stripe charged less for, with both amounts.
    const short = lines.filter({ hasText: "Amount differs" });
    await expect(short).toContainText(PURCHASES.stripe.payment.id);
    await expect(short).toContainText("¥500");
    await expect(short).toContainText("¥400");

    // Narrowing to one kind leaves its line alone.
    await findings
      .getByRole("link", { exact: true, name: "Amount differs" })
      .click();
    await expect(page).toHaveURL(/kind=amount_mismatch/u);
    await expect(lines).toHaveCount(1);

    // A line about a purchase opens it.
    await lines.getByRole("link", { name: "Open the purchase" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/purchases\\?purchase=${PURCHASES.stripe.id}`, "u")
    );
    await expect(drawer(page)).toContainText(PURCHASES.stripe.id);
  });
});
