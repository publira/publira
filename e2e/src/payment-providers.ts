import { randomUUID } from "node:crypto";

import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsAdmin } from "./admin";
import { runSql } from "./db";
import { revalidateStorefrontTags, tenantSiteTag } from "./revalidate";

/**
 * Adds PAY.JP beside the provider a tenant already takes payments through,
 * signed in as `admin` on the console at `adminBaseUrl`, and puts it first
 * among the tenant's providers, which is the one a checkout starts on until
 * the reader chooses another.
 *
 * The stack has no stand-in for PAY.JP, so its keys are made up: they make it
 * a provider the site offers, and no checkout is ever started through it. It
 * is put first so that a checkout that reaches the other provider's page is
 * one the reader chose, not the one the site starts on.
 *
 * Nothing on a screen changes the order the providers were added in, so the
 * order is written to Postgres, and the storefront's read of the tenant, which
 * lists them, is dropped after it.
 */
export const takePaymentsThroughPayjpFirst = async (
  page: Page,
  admin: { email: string; password: string },
  adminBaseUrl: string,
  tenant: { id: string; publicId: string }
): Promise<void> => {
  await signInAsAdmin(page, admin, "/integrations/payment", adminBaseUrl);

  const form = page.getByRole("region", {
    exact: true,
    name: "Add a provider",
  });

  const provider = form.getByRole("combobox", { name: "Payment provider" });
  await provider.click();
  await page.getByRole("option", { name: "PAY.JP" }).click();
  await expect(provider).toContainText("PAY.JP");

  await form.getByRole("checkbox", { name: "Enable payments" }).click();
  const suffix = randomUUID().replaceAll("-", "");
  await form.getByLabel(/^Secret key/u).fill(`sk_test_${suffix}`);
  await form.getByLabel(/^Webhook token/u).fill(`whook_${suffix}`);
  await form.getByRole("button", { exact: true, name: "Add provider" }).click();
  await expect(page.getByText("PAY.JP was added.")).toBeVisible();

  runSql(`
    UPDATE tenant_payment_providers p
    SET created_at = first.created_at - INTERVAL '1 second'
    FROM (
      SELECT MIN(created_at) AS created_at
      FROM tenant_payment_providers
      WHERE tenant_id = (SELECT id FROM tenants WHERE public_id = '${tenant.publicId}')
    ) AS first
    WHERE p.provider = 'payjp'
      AND p.tenant_id = (SELECT id FROM tenants WHERE public_id = '${tenant.publicId}');
  `);
  await revalidateStorefrontTags([tenantSiteTag(tenant.id)]);
};
