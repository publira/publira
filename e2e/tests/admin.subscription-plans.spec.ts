import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import {
  SUBSCRIPTION_PLANS_ADMIN,
  SUBSCRIPTION_PLANS_LABEL,
  SUBSCRIPTION_PLANS_SCENARIO,
  SUBSCRIPTION_PLANS_SEEDED_PLAN,
} from "../src/scenarios/subscription-plans";
import { createStripePrice } from "../src/stripe";
import { WEB_ADMIN_SUBSCRIPTION_PLANS_BASE_URL } from "../src/urls";

/**
 * A tenant administrator creating a subscription plan at
 * `/subscription-plans` against a Price on the tenant's Stripe account, here
 * the stack's stand-in for Stripe, editing and unpublishing it, and deleting
 * it, while the plan a reader already pays for is kept. The plan names the
 * product each store sells it as, which Store products then lists for the
 * tenant to create.
 */

const PLANS_PATH = "/subscription-plans";

const adminUrl = (path: string) =>
  new URL(path, WEB_ADMIN_SUBSCRIPTION_PLANS_BASE_URL).toString();

const signIn = (page: Page, path = PLANS_PATH) =>
  signInAsAdmin(
    page,
    SUBSCRIPTION_PLANS_ADMIN,
    path,
    WEB_ADMIN_SUBSCRIPTION_PLANS_BASE_URL
  );

const planRow = (page: Page, name: string) =>
  page.getByRole("row").filter({
    has: page.getByRole("cell", { exact: true, name }),
  });

/**
 * Takes the tenant's payments through Stripe, which a plan's Price is read
 * through, and answers the secret key it stored. The key is a new one each
 * run, a test account of its own, whose Prices are the ones the run makes.
 */
const takePaymentsThroughStripe = async (page: Page): Promise<string> => {
  const secretKey = `sk_test_${randomUUID().replaceAll("-", "")}`;

  await page.goto(adminUrl("/integrations/payment"));
  const provider = page.getByRole("combobox", { name: "Payment provider" });
  await provider.click();
  await page.getByRole("option", { name: "Stripe" }).click();
  await expect(provider).toContainText("Stripe");

  await page.getByRole("checkbox", { name: "Enable payments" }).click();
  await page.getByLabel(/^Secret key/u).fill(secretKey);
  await page.getByLabel(/^Webhook signing secret/u).fill("whsec_placeholder");
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(
    page.getByText("The payment settings were saved.")
  ).toBeVisible();

  return secretKey;
};

/** Fills the plan form for a plan of the scenario's label. */
const fillLabelPlan = async (
  page: Page,
  plan: {
    appStoreProductId?: string;
    googlePlayProductId?: string;
    name: string;
    priceId: string;
  }
) => {
  await page.getByLabel(/^Name/u).fill(plan.name);
  await page
    .getByLabel("Description")
    .fill("Every episode of the label, every month.");
  await page.getByLabel(/^Stripe Price ID/u).fill(plan.priceId);
  await page
    .getByLabel("App Store product ID")
    .fill(plan.appStoreProductId ?? "");
  await page
    .getByLabel("Google Play product ID")
    .fill(plan.googlePlayProductId ?? "");
  await page.getByRole("radio", { name: "Labels" }).click();
  const labels = page.getByPlaceholder("Search labels");
  await labels.click();
  await labels.fill(SUBSCRIPTION_PLANS_LABEL.name);
  await page
    .getByRole("option", { name: SUBSCRIPTION_PLANS_LABEL.name })
    .click();
  await page.getByRole("checkbox", { name: "Publish" }).click();
};

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  applyScenarioSql(SUBSCRIPTION_PLANS_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(SUBSCRIPTION_PLANS_SCENARIO);
});

test.describe("Subscription plans", () => {
  test("lists a plan with its subscribers and keeps it from being deleted", async ({
    page,
  }) => {
    await signIn(page);
    await expect(
      page.getByRole("heading", { exact: true, name: "Subscription plans" })
    ).toBeVisible();

    const seeded = planRow(page, SUBSCRIPTION_PLANS_SEEDED_PLAN.name);
    await expect(seeded).toContainText("¥980 a month");
    await expect(seeded).toContainText("Whole catalog");
    await expect(seeded).toContainText("Published");
    // The app sells it in no store.
    await expect(seeded).toContainText("None");
    await expect(
      seeded.getByRole("cell", { exact: true, name: "1" })
    ).toBeVisible();

    await seeded.getByRole("button", { exact: true, name: "Delete" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { exact: true, name: "Delete" })
      .click();
    await expect(
      page.getByText(
        "Readers have subscribed to this plan, so it is kept as the record of what they pay for. Unpublish it instead."
      )
    ).toBeVisible();
    await page.reload();
    await expect(
      planRow(page, SUBSCRIPTION_PLANS_SEEDED_PLAN.name)
    ).toBeVisible();
  });

  test("creates a plan of a label against a Stripe Price and two store products, then unpublishes and deletes it", async ({
    page,
  }) => {
    const name = "Label pass";
    await signIn(page, `${PLANS_PATH}/new`);

    // While the tenant takes no payments through Stripe, there is no account
    // to read a Price from.
    await fillLabelPlan(page, { name, priceId: "price_not_read_yet" });
    await page
      .getByRole("button", { exact: true, name: "Create plan" })
      .click();
    await expect(
      page.getByText(
        "Subscription plans are sold through Stripe. Choose Stripe under Payments › Payment methods, enable payments, and save, then try again."
      )
    ).toBeVisible();

    const secretKey = await takePaymentsThroughStripe(page);

    const priceId = await createStripePrice(secretKey, {
      amount: 1200,
      currency: "jpy",
      interval: "month",
    });

    // A Price the account does not hold is named as the field to correct.
    await page.goto(adminUrl(`${PLANS_PATH}/new`));
    await fillLabelPlan(page, { name, priceId: "price_unknown" });
    await page
      .getByRole("button", { exact: true, name: "Create plan" })
      .click();
    await expect(
      page.getByText(
        "Stripe has no active recurring Price of one fixed amount with this ID on the tenant's account. Check the ID, and that the Price bills the same amount every period."
      )
    ).toBeVisible();

    await page.goto(adminUrl(`${PLANS_PATH}/new`));
    await fillLabelPlan(page, {
      appStoreProductId: "label_pass",
      googlePlayProductId: "label.pass",
      name,
      priceId,
    });
    await page
      .getByRole("button", { exact: true, name: "Create plan" })
      .click();

    // The plan opens on its own screen with what Stripe says the Price bills.
    await expect(page).toHaveURL(/\/subscription-plans\/[^/?]+/u);
    await expect(page.getByText("Subscription plan created.")).toBeVisible();
    await expect(page.getByText("¥1,200 a month")).toBeVisible();
    // The new screen the Action redirected from stays mounted, hidden, so the
    // plan is looked for among what is shown.
    await expect(page.getByRole("textbox", { name: /^Name/u })).toHaveValue(
      name
    );
    await expect(
      page.getByRole("textbox", { name: "App Store product ID" })
    ).toHaveValue("label_pass");
    await expect(
      page.getByRole("textbox", { name: "Google Play product ID" })
    ).toHaveValue("label.pass");
    await expect(page.getByRole("radio", { name: "Labels" })).toBeChecked();
    await expect(
      page.getByText(SUBSCRIPTION_PLANS_LABEL.name).filter({ visible: true })
    ).toBeVisible();

    await page.getByRole("checkbox", { name: "Publish" }).click();
    await page
      .getByRole("button", { exact: true, name: "Save changes" })
      .click();
    await expect(page.getByText("Subscription plan updated.")).toBeVisible();

    await page.goto(adminUrl(PLANS_PATH));
    const created = planRow(page, name);
    await expect(created).toContainText("¥1,200 a month");
    await expect(created).toContainText("1 label");
    await expect(created).toContainText("Unpublished");
    await expect(
      created.getByRole("cell", { exact: true, name: "0" })
    ).toBeVisible();
    await expect(created).toContainText("App Store");
    await expect(created).toContainText("Google Play");

    // Store products names the subscription to create in each store.
    await page.goto(adminUrl("/integrations/payment"));
    await expect(
      page.getByRole("heading", { exact: true, name: "Subscription plans" })
    ).toBeVisible();
    const product = page.getByRole("row").filter({ hasText: name });
    await expect(product).toContainText("¥1,200 a month");
    await expect(product).toContainText("label_pass");
    await expect(product).toContainText("label.pass");

    // A second plan cannot be sold as the same App Store product, and the
    // field that says so is that one.
    const secondPriceId = await createStripePrice(secretKey, {
      amount: 2400,
      currency: "jpy",
      interval: "month",
    });

    await page.goto(adminUrl(`${PLANS_PATH}/new`));
    await fillLabelPlan(page, {
      appStoreProductId: "label_pass",
      name: "Second label pass",
      priceId: secondPriceId,
    });
    await page
      .getByRole("button", { exact: true, name: "Create plan" })
      .click();
    await expect(
      page.getByText(
        "Another plan is already sold as this App Store product. Create a subscription of its own for this plan in App Store Connect."
      )
    ).toBeVisible();
    await expect(
      page.getByText("Please check the information you entered.")
    ).toBeVisible();

    await page.goto(adminUrl(PLANS_PATH));
    await expect(planRow(page, "Second label pass")).toHaveCount(0);

    // Nobody has subscribed to it, so it can go.
    await planRow(page, name)
      .getByRole("button", { exact: true, name: "Delete" })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { exact: true, name: "Delete" })
      .click();
    await expect(planRow(page, name)).toHaveCount(0);
    await expect(
      planRow(page, SUBSCRIPTION_PLANS_SEEDED_PLAN.name)
    ).toBeVisible();
  });
});
