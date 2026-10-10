import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { deleteTenantsByPublicIds, quoteSqlLiteral, runSql } from "../src/db";
import {
  createTenantViaUi,
  signInAsSeedPlatformSuperAdmin,
} from "../src/platform";
import { uniqueSuffix } from "../src/scenarios/platform-tenants";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

const platformUrl = (pathname: string): string =>
  `${WEB_PLATFORM_BASE_URL}${pathname}`;

/** A confirmed user of the tenant who holds no console role yet. */
const seedTenantUser = (
  tenantPublicId: string,
  userPublicId: string,
  email: string
): void => {
  runSql(`
    INSERT INTO users (id, tenant_id, public_id, email, password_hash, name, status, email_verified_at)
    SELECT uuidv7(), t.id, ${quoteSqlLiteral(userPublicId)}, ${quoteSqlLiteral(email)},
      'unused', 'Members E2E Reader', 'active', NOW()
    FROM tenants t
    WHERE t.public_id = ${quoteSqlLiteral(tenantPublicId)};
  `);
};

const statusMessage = (page: Page, text: string): Locator =>
  page.getByRole("status").filter({ hasText: text });

const rowFor = (page: Page, email: string): Locator =>
  page.locator("tr", { hasText: email });

/**
 * The Members screen resolves the tenant its URL names once, then addresses the
 * tenant, its members, and its invitations by internal ID. Each operation is
 * driven through the screen so a request that names the wrong field fails here.
 */
test.describe("platform tenant members", () => {
  let tenantPublicId = "";

  test.beforeEach(async ({ page }) => {
    await signInAsSeedPlatformSuperAdmin(page);
    const suffix = uniqueSuffix();
    tenantPublicId = await createTenantViaUi(page, {
      domain: `members-${suffix}.localhost`,
      name: `E2E Members Tenant ${suffix}`,
    });
  });

  test.afterEach(() => {
    deleteTenantsByPublicIds([tenantPublicId]);
    tenantPublicId = "";
  });

  test("adds a member, changes their role, and removes them", async ({
    page,
  }) => {
    const email = `reader-${uniqueSuffix()}@example.com`;
    seedTenantUser(tenantPublicId, uniqueSuffix(), email);

    await page.goto(platformUrl(`/tenants/${tenantPublicId}/members`));
    await page
      .getByRole("textbox", { name: /^Email address to add/u })
      .fill(email);
    await page.getByRole("combobox", { name: /^Role/u }).click();
    await page.getByRole("option", { name: "Editor" }).click();
    await page.getByRole("button", { exact: true, name: "Add member" }).click();

    await expect(statusMessage(page, "Member added.")).toBeVisible();
    await expect(
      rowFor(page, email).getByText("Editor", { exact: true })
    ).toBeVisible();

    await rowFor(page, email)
      .getByRole("button", { exact: true, name: "Change role" })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("radio", { name: "Auditor" }).check();
    await dialog
      .getByRole("button", { exact: true, name: "Change role" })
      .click();

    // The dialog closes once the role is saved, taking its status line with it.
    await expect(dialog).toBeHidden();
    await expect(
      rowFor(page, email).getByText("Auditor", { exact: true })
    ).toBeVisible();

    await rowFor(page, email)
      .getByRole("button", { exact: true, name: "Remove" })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { exact: true, name: "Remove" })
      .click();

    await expect(statusMessage(page, "Member removed.")).toBeVisible();
    await expect(rowFor(page, email)).toHaveCount(0);
  });

  test("invites an admin, resends the invitation, and cancels it", async ({
    page,
  }) => {
    const email = `invitee-${uniqueSuffix()}@example.com`;

    await page.goto(platformUrl(`/tenants/${tenantPublicId}/members`));
    await page
      .getByRole("textbox", { name: /^Email address to invite/u })
      .fill(email);
    await page
      .getByRole("button", { exact: true, name: "Invite admin" })
      .click();

    await expect(statusMessage(page, "Invitation email sent.")).toBeVisible();
    await expect(
      rowFor(page, email).getByText("Tenant admin", { exact: true })
    ).toBeVisible();
    await expect(
      rowFor(page, email).getByText("Pending", { exact: true })
    ).toBeVisible();

    await rowFor(page, email)
      .getByRole("button", { exact: true, name: "Resend" })
      .click();
    await expect(statusMessage(page, "Invitation email resent.")).toBeVisible();

    await rowFor(page, email)
      .getByRole("button", { exact: true, name: "Cancel" })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { exact: true, name: "Cancel invitation" })
      .click();

    await expect(statusMessage(page, "Invitation canceled.")).toBeVisible();
    await expect(
      rowFor(page, email).getByText("Canceled", { exact: true })
    ).toBeVisible();
  });
});
