import { randomUUID } from "node:crypto";

import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsAdmin } from "./admin";
import { formMessage, signInAsPlatformOperator } from "./platform";
import { revalidatePlatformTags } from "./revalidate";
import { PLATFORM_TENANT_COINS_OPERATOR } from "./scenarios/platform-tenant-coins";
import { registerStripeWebhook } from "./stripe";

/**
 * Lets tenants issue coins, or stops them, from the Platform Console's
 * Security page, as the operator `660_platform_tenant_coins.sql` seeds. Saving
 * there writes the policy row and owes every tenant's catalog a drop once the
 * API's own cache of the policy has run out.
 *
 * A scenario writes the policy row straight to Postgres, which leaves the
 * console holding the revision it read before, and the save of a stale
 * revision is refused. The console's policy tag is dropped first and the save
 * tried again until the form carries the revision that is stored.
 */
export const setTenantCoinsAllowed = async (
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
 * Takes a tenant's payments through Stripe, which is what sells its packs,
 * signed in as `admin` on the console at `adminBaseUrl`. The secret key is a
 * new one each run, a test account of its own, for the reason
 * `storefront.checkout.spec.ts` gives.
 */
export const takePaymentsThroughStripe = async (
  page: Page,
  admin: { email: string; password: string },
  adminBaseUrl: string
): Promise<void> => {
  await signInAsAdmin(page, admin, "/integrations/payment", adminBaseUrl);
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
