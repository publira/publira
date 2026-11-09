import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql, querySql, runSql } from "../src/db";
import {
  signInAsPlatformOperator,
  signInAsSeedPlatformSuperAdmin,
} from "../src/platform";
import {
  DELETION_AUDITOR,
  DELETION_OPERATOR,
  DELETION_TENANT,
  TENANT_DELETION_SCENARIO,
} from "../src/scenarios/tenant-deletion";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

const TENANT_PATH = `/tenants/${DELETION_TENANT.publicId}`;

/**
 * The tenant list narrowed to this tenant's name, so its absence is not that
 * of a row on another page.
 */
const LIST_URL = `${WEB_PLATFORM_BASE_URL}/tenants?name=${encodeURIComponent(DELETION_TENANT.name)}`;

/**
 * The worker erases a deleted tenant on a one-minute schedule, and the console
 * keeps a tenant list it has read for a minute before it reads it again, so
 * the tenant can take two minutes to leave the list.
 */
const ERASURE_TIMEOUT = 180_000;

const EMPTY_FILTERED = "No tenants match these filters.";

/** Rows the scenario gave the tenant in a table the worker erases. */
const countTenantRows = (): number =>
  Number(
    querySql(
      `SELECT count(*) FROM users WHERE tenant_id = '${DELETION_TENANT.id}'`
    )
  );

const tenantRow = (page: Page) =>
  page.getByRole("row").filter({ hasText: DELETION_TENANT.name });

/**
 * **Delete tenant** on a suspended tenant's page, from the dialog to the
 * worker's erasure of the tenant.
 *
 * The tenant is one of its own (`810_tenant_deletion.sql`), suspended from the
 * start. The project runs after the web-platform one rather than beside it:
 * the erasure files a notification for every operator, and
 * `platform.notifications.spec.ts` expects the seeded Super admin's inbox to
 * be empty.
 */
test.describe("deleting a tenant", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    applyScenarioSql(TENANT_DELETION_SCENARIO);
  });

  // Removed rather than written again: a tenant left behind would be in the
  // tenant list the screenshot suites photograph on the next run.
  test.afterAll(() => {
    runSql(`
      DELETE FROM platform_notifications
      WHERE subject_key = 'tenant:${DELETION_TENANT.publicId}';
      DELETE FROM audit_logs WHERE tenant_id = '${DELETION_TENANT.id}';
      DELETE FROM tenants WHERE public_id = '${DELETION_TENANT.publicId}';
    `);
  });

  for (const [role, account] of [
    ["an Operator", DELETION_OPERATOR],
    ["an Auditor", DELETION_AUDITOR],
  ] as const) {
    test(`is not offered to ${role}`, async ({ page }) => {
      await signInAsPlatformOperator(page, account, TENANT_PATH);

      await expect(
        page.getByRole("heading", { name: `Tenant: ${DELETION_TENANT.name}` })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { exact: true, name: "Delete tenant" })
      ).toHaveCount(0);
    });
  }

  test("a Super admin deletes a suspended tenant, which leaves the list once the worker has erased it", async ({
    page,
  }) => {
    test.setTimeout(ERASURE_TIMEOUT + 60_000);

    await signInAsSeedPlatformSuperAdmin(page, TENANT_PATH);
    await page
      .getByRole("button", { exact: true, name: "Delete tenant" })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", {
        name: `Delete ${DELETION_TENANT.name}?`,
      })
    ).toBeVisible();

    const nameField = dialog.getByRole("textbox", {
      name: /^Type the tenant's name to confirm/u,
    });

    const confirm = dialog.getByRole("button", {
      exact: true,
      name: "Delete tenant",
    });

    // The name has to be typed exactly before the control opens.
    await expect(confirm).toBeDisabled();
    await nameField.fill(DELETION_TENANT.name.toLowerCase());
    await expect(confirm).toBeDisabled();
    await nameField.fill(DELETION_TENANT.name);
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(
      page.getByRole("status").filter({
        hasText: "This tenant is being deleted",
      })
    ).toBeVisible();
    await expect(page.getByText("Deleting", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { exact: true, name: "Resume" })
    ).toBeDisabled();
    await expect(
      page
        .getByRole("textbox", { name: /^Tenant name/u })
        .filter({ visible: true })
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { exact: true, name: "Delete tenant" })
    ).toHaveCount(0);

    await page.goto(LIST_URL);
    await expect(tenantRow(page).getByText("Deleting")).toBeVisible();

    await expect(async () => {
      await page.reload();
      await expect(page.getByText(EMPTY_FILTERED)).toBeVisible();
      await expect(tenantRow(page)).toHaveCount(0);
    }).toPass({ intervals: [5000], timeout: ERASURE_TIMEOUT });

    expect(countTenantRows()).toBe(0);

    await page.goto(`${WEB_PLATFORM_BASE_URL}/notifications`);
    await expect(
      page.getByRole("main").getByText("A tenant was deleted").first()
    ).toBeVisible();
  });
});
