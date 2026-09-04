import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  applyScenarioSql,
  deleteTenantsByPublicIds,
  querySql,
} from "../src/db";
import {
  createTenantViaUi,
  formMessage,
  signInAsScenarioPlatformOperator,
  signInAsSeedPlatformSuperAdmin,
  signOutPlatform,
} from "../src/platform";
import {
  PLATFORM_OPERATORS_SCENARIO,
  uniqueSuffix,
} from "../src/scenarios/platform-tenants";
import {
  WEB_ADMIN_BASE_URL,
  WEB_HOST_BASE_URL,
  WEB_PLATFORM_BASE_URL,
} from "../src/urls";

const platformUrl = (pathname: string): string =>
  `${WEB_PLATFORM_BASE_URL}${pathname}`;

const withHostname = (baseUrl: string, hostname: string): string => {
  const url = new URL(baseUrl);
  url.hostname = hostname;
  return url.toString().replace(/\/$/u, "");
};

/**
 * Visible detail-page fields. After the create form redirects here it stays
 * mounted in the router bfcache, so both pages' inputs are in the document at
 * once; the visibility filter keeps the hidden page out.
 */
const tenantNameInput = (page: Page): Locator =>
  page
    .getByRole("textbox", { name: /^Tenant name/u })
    .filter({ visible: true })
    .first();

const tenantDomainInput = (page: Page): Locator =>
  page
    .getByRole("textbox", { name: /^Domain/u })
    .filter({ visible: true })
    .first();

const tenantAdminDomainInput = (page: Page): Locator =>
  page
    .getByRole("textbox", { name: /^Admin domain/u })
    .filter({ visible: true })
    .first();

const tenantNameForm = (page: Page): Locator =>
  page
    .locator("form")
    .filter({ has: page.getByRole("textbox", { name: /^Tenant name/u }) })
    .filter({ visible: true })
    .first();

const tenantDomainForm = (page: Page): Locator =>
  page
    .locator("form")
    .filter({ has: page.getByRole("textbox", { name: /^Domain/u }) })
    .filter({ visible: true })
    .first();

/**
 * Platform Console → platform API → public/admin tenant resolution.
 *
 * Login is a prerequisite helper (full auth coverage is
 * `platform.auth.spec.ts`). Each test uses a unique name/domain so runs do not
 * depend on leftover rows. Tenants created during the suite are deleted in
 * `afterEach` so `task e2e:test` against a long-lived stack does not
 * accumulate rows.
 */
test.describe("platform tenant operations", () => {
  /** Tenant public_ids created in the current test; drained by afterEach. */
  let createdTenantIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdTenantIds = [];
    await signInAsSeedPlatformSuperAdmin(page);
  });

  test.afterEach(() => {
    deleteTenantsByPublicIds(createdTenantIds);
    createdTenantIds = [];
  });

  const trackTenant = (publicId: string): string => {
    createdTenantIds.push(publicId);
    return publicId;
  };

  test("creates a tenant and reads it back in the list and the detail", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Platform Tenant ${suffix}`;
    const domain = `e2e-${suffix}.localhost`;
    const adminDomain = `admin-e2e-${suffix}.localhost`;

    const tenantId = trackTenant(
      await createTenantViaUi(page, { adminDomain, domain, name })
    );

    await expect(page).toHaveURL(new RegExp(`/tenants/${tenantId}`, "u"));
    await expect(
      page.getByRole("heading", { name: `Tenant: ${name}` })
    ).toBeVisible();
    await expect(page.getByText("Active").first()).toBeVisible();
    await expect(tenantNameInput(page)).toHaveValue(name);
    await expect(tenantDomainInput(page)).toHaveValue(domain);
    await expect(tenantAdminDomainInput(page)).toHaveValue(adminDomain);

    await page.goto(platformUrl("/tenants"));
    await expect(page.getByText(name)).toBeVisible();
    await expect(
      page.locator("tr", { hasText: name }).getByText(tenantId)
    ).toBeVisible();
    await expect(
      page.locator("tr", { hasText: name }).getByText("Active")
    ).toBeVisible();
  });

  test("updates name and domain, and the tenant detail shows the new values", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Edit Tenant ${suffix}`;
    const domain = `e2e-edit-${suffix}.localhost`;
    const adminDomain = `admin-e2e-edit-${suffix}.localhost`;

    const tenantId = trackTenant(
      await createTenantViaUi(page, { adminDomain, domain, name })
    );

    const editedName = `${name} (edited)`;
    await tenantNameInput(page).fill(editedName);
    await tenantNameForm(page).getByRole("button", { name: "Save" }).click();
    await expect(formMessage(page)).toContainText("Saved.");
    // Re-fetch so the server-rendered heading and input defaults match the save.
    await page.goto(platformUrl(`/tenants/${tenantId}`));
    await expect(tenantNameInput(page)).toHaveValue(editedName);
    await expect(
      page.getByRole("heading", { name: `Tenant: ${editedName}` })
    ).toBeVisible();

    const newDomain = `e2e-edit2-${suffix}.localhost`;
    const newAdminDomain = `admin-e2e-edit2-${suffix}.localhost`;
    await tenantDomainInput(page).fill(newDomain);
    await tenantAdminDomainInput(page).fill(newAdminDomain);
    await tenantDomainForm(page).getByRole("button", { name: "Save" }).click();
    await expect(formMessage(page)).toContainText("Saved.");

    // Reload pins the server-side re-fetch, not just client form state.
    await page.goto(platformUrl(`/tenants/${tenantId}`));
    await expect(tenantNameInput(page)).toHaveValue(editedName);
    await expect(tenantDomainInput(page)).toHaveValue(newDomain);
    await expect(tenantAdminDomainInput(page)).toHaveValue(newAdminDomain);
  });

  test("domain / admin_domain reach tenant resolution in web-host and web-admin", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Domain Tenant ${suffix}`;
    const domain = `e2e-dom-${suffix}.localhost`;
    const adminDomain = `admin-e2e-dom-${suffix}.localhost`;

    const tenantId = trackTenant(
      await createTenantViaUi(page, { adminDomain, domain, name })
    );

    const hostBase = withHostname(WEB_HOST_BASE_URL, domain);
    const hostResponse = await page.goto(`${hostBase}/`);
    expect(hostResponse?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Catalog" })
    ).toBeVisible();
    // New tenants have no site description; the tenant name is the site label.
    await expect(
      page
        .getByRole("paragraph")
        .filter({ hasText: new RegExp(`^${name}$`, "u") })
    ).toBeVisible();

    const adminBase = withHostname(WEB_ADMIN_BASE_URL, adminDomain);
    const adminResponse = await page.goto(`${adminBase}/login`);
    expect(adminResponse?.status(), await page.content()).toBe(200);
    await expect(page.getByLabel(/Email address/u)).toBeVisible();
    // Must not be the unknown-host 404 from proxy.ts.
    await expect(page.getByText("Not Found")).toHaveCount(0);

    // Change domains and confirm resolution follows the new Hosts.
    // Session cookie is host-scoped to platform.localhost and survives the
    // detour through other Hosts.
    await page.goto(platformUrl(`/tenants/${tenantId}`));
    if (page.url().includes("/login")) {
      await signInAsSeedPlatformSuperAdmin(page, `/tenants/${tenantId}`);
    }

    const movedDomain = `e2e-dom2-${suffix}.localhost`;
    const movedAdminDomain = `admin-e2e-dom2-${suffix}.localhost`;
    await tenantDomainInput(page).fill(movedDomain);
    await tenantAdminDomainInput(page).fill(movedAdminDomain);
    await tenantDomainForm(page).getByRole("button", { name: "Save" }).click();
    await expect(formMessage(page)).toContainText("Saved.");

    // DB is the source of truth; web-host keeps a positive-hit LRU for ~5 min so
    // the old Host can still answer until the cache entry expires.
    expect(
      querySql(`
        SELECT domain || '|' || COALESCE(admin_domain, '')
        FROM tenants
        WHERE public_id = '${tenantId}'
        LIMIT 1
      `)
    ).toBe(`${movedDomain}|${movedAdminDomain}`);

    const movedHost = withHostname(WEB_HOST_BASE_URL, movedDomain);
    const movedHostResponse = await page.goto(`${movedHost}/`);
    expect(movedHostResponse?.status(), await page.content()).toBe(200);
    await expect(
      page
        .getByRole("paragraph")
        .filter({ hasText: new RegExp(`^${name}$`, "u") })
    ).toBeVisible();

    const movedAdmin = withHostname(WEB_ADMIN_BASE_URL, movedAdminDomain);
    const movedAdminResponse = await page.goto(`${movedAdmin}/login`);
    expect(movedAdminResponse?.status(), await page.content()).toBe(200);
    await expect(page.getByLabel(/Email address/u)).toBeVisible();
  });

  test("suspends and resumes a tenant, and the list reflects the new state", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Status Tenant ${suffix}`;
    const domain = `e2e-status-${suffix}.localhost`;

    const tenantId = trackTenant(
      await createTenantViaUi(page, { domain, name })
    );

    await page.getByRole("button", { name: "Suspend" }).click();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Suspended").first()).toBeVisible();

    await page.goto(platformUrl("/tenants"));
    await expect(
      page.locator("tr", { hasText: name }).getByText("Suspended")
    ).toBeVisible();

    await page.goto(platformUrl(`/tenants/${tenantId}`));
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByRole("button", { name: "Suspend" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Active").first()).toBeVisible();

    await page.goto(platformUrl("/tenants"));
    await expect(
      page.locator("tr", { hasText: name }).getByText("Active")
    ).toBeVisible();
  });

  test("key operations are recorded in the audit log", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Audit Tenant ${suffix}`;
    const domain = `e2e-audit-${suffix}.localhost`;

    const tenantId = trackTenant(
      await createTenantViaUi(page, { domain, name })
    );

    await tenantNameInput(page).fill(`${name} (audited)`);
    await tenantNameForm(page).getByRole("button", { name: "Save" }).click();
    await expect(formMessage(page)).toContainText("Saved.");

    await page.getByRole("button", { name: "Suspend" }).click();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByRole("button", { name: "Suspend" })).toBeVisible({
      timeout: 30_000,
    });

    // Pin each action to this tenant's UUID (target_id). Action labels alone
    // can match leftover rows from earlier runs because cleanup does not
    // delete platform_audit_logs.
    // public_id is Base58 from the server — safe for a single-quoted literal.
    const auditActionCount = (action: string): string =>
      querySql(`
        SELECT COUNT(*)::text
        FROM platform_audit_logs pal
        JOIN tenants t ON pal.target_id = t.id::text
        WHERE t.public_id = '${tenantId}'
          AND pal.target_type = 'tenant'
          AND pal.action = '${action}'
          AND pal.outcome = 'success'
      `);

    expect(auditActionCount("tenant_created"), "tenant_created").toBe("1");
    expect(auditActionCount("tenant_info_updated"), "tenant_info_updated").toBe(
      "1"
    );
    expect(auditActionCount("tenant_suspended"), "tenant_suspended").toBe("1");
    expect(auditActionCount("tenant_resumed"), "tenant_resumed").toBe("1");

    // The audit list surfaces the same event types under their own labels.
    await page.goto(platformUrl("/audit-logs?action=tenant_created"));
    await expect(
      page.getByRole("heading", { name: "Audit logs" })
    ).toBeVisible();
    await expect(page.getByText("Created a tenant").first()).toBeVisible();
    await expect(page.locator("table tbody tr").first()).toBeVisible();

    // Detail deep-link still reaches the tenant we just mutated.
    await page.goto(platformUrl(`/tenants/${tenantId}`));
    await expect(
      page.getByRole("heading", { name: `Tenant: ${name} (audited)` })
    ).toBeVisible();
  });

  test("an operator without the required permission cannot create an operator", async ({
    page,
  }) => {
    applyScenarioSql(PLATFORM_OPERATORS_SCENARIO);

    // Drop super-admin session and sign in as platform_operator.
    await signOutPlatform(page);
    await signInAsScenarioPlatformOperator(page, "/operators/new");

    await expect(
      page.getByRole("heading", { name: /Add operator/u }).first()
    ).toBeVisible();

    const suffix = uniqueSuffix();
    await page
      .getByRole("textbox", { name: /^Name/u })
      .fill(`Denied Operator ${suffix}`);
    await page
      .getByRole("textbox", { name: /^Email address/u })
      .fill(`denied-${suffix}@example.com`);
    // Base UI Select trigger is the only combobox on this form.
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Operator" }).click();
    await page.getByRole("button", { name: "Add" }).click();

    await expect(formMessage(page)).toContainText(
      "You do not have permission to perform this action."
    );
    // Still on the create form — no redirect to the list.
    await expect(page).toHaveURL(/\/operators\/new/u);
  });

  test("an operator without the required permission can still read the tenant list", async ({
    page,
  }) => {
    applyScenarioSql(PLATFORM_OPERATORS_SCENARIO);

    const suffix = uniqueSuffix();
    const name = `E2E Visible Tenant ${suffix}`;
    const domain = `e2e-visible-${suffix}.localhost`;
    trackTenant(await createTenantViaUi(page, { domain, name }));

    await signOutPlatform(page);
    await signInAsScenarioPlatformOperator(page, "/tenants");

    await expect(page.getByText(name)).toBeVisible();
    await page
      .locator("tr", { hasText: name })
      .getByRole("link", { name: "Details" })
      .click();
    await expect(
      page.getByRole("heading", { name: `Tenant: ${name}` })
    ).toBeVisible();
  });

  test("a missing required field shows an error", async ({ page }) => {
    await page.goto(platformUrl("/tenants/new"));
    await page
      .getByRole("textbox", { name: /^Tenant name/u })
      .fill(`E2E Invalid ${uniqueSuffix()}`);
    // Leave domain empty — HTML required may block submit; clear via fill and
    // also try submit. If native validation blocks, the test still documents
    // the server-side path when domain is whitespace-only after bypass.
    await tenantDomainInput(page).fill("   ");
    await page.getByRole("button", { name: "Create" }).click();

    // Either browser constraint validation keeps us on the form, or the server
    // action answers with an error. Never a successful redirect.
    await expect(page).toHaveURL(/\/tenants\/new/u);
    const domainInput = tenantDomainInput(page);
    const validationMessage = await domainInput.evaluate(
      (el: HTMLInputElement) => el.validationMessage
    );
    if (validationMessage) {
      expect(validationMessage.length).toBeGreaterThan(0);
    } else {
      await expect(formMessage(page)).toContainText(
        /Tenant name and domain are required|required/u
      );
    }
  });
});
