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

/** Visible name field on the detail page (avoids duplicate name= during RSC churn). */
const tenantNameInput = (page: Page): Locator =>
  page.getByRole("textbox", { name: /テナント名/u }).first();

const tenantNameForm = (page: Page): Locator =>
  page
    .locator("form")
    .filter({ has: page.getByRole("textbox", { name: /テナント名/u }) })
    .first();

const tenantDomainForm = (page: Page): Locator =>
  page
    .locator("form")
    .filter({ has: page.locator("#tenant_domain") })
    .first();

/**
 * Platform Console → platform API → public/admin tenant resolution (#517).
 *
 * Login is a prerequisite helper (full auth coverage is #67). Each test uses a
 * unique name/domain so runs do not depend on leftover rows. Tenants created
 * during the suite are deleted in `afterEach` so `task e2e:test` against a
 * long-lived stack does not accumulate rows.
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

  test("テナントを作成し、一覧と詳細で再取得できる", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Platform Tenant ${suffix}`;
    const domain = `e2e-${suffix}.localhost`;
    const adminDomain = `admin-e2e-${suffix}.localhost`;

    const tenantId = trackTenant(
      await createTenantViaUi(page, { adminDomain, domain, name })
    );

    await expect(page).toHaveURL(new RegExp(`/tenants/${tenantId}`, "u"));
    await expect(
      page.getByRole("heading", { name: `テナント詳細: ${name}` })
    ).toBeVisible();
    await expect(page.getByText("稼働中").first()).toBeVisible();
    await expect(tenantNameInput(page)).toHaveValue(name);
    await expect(page.locator("#tenant_domain")).toHaveValue(domain);
    await expect(page.locator("#tenant_admin_domain")).toHaveValue(adminDomain);

    await page.goto(platformUrl("/tenants"));
    await expect(page.getByText(name)).toBeVisible();
    await expect(
      page.locator("tr", { hasText: name }).getByText(tenantId)
    ).toBeVisible();
    await expect(
      page.locator("tr", { hasText: name }).getByText("稼働中")
    ).toBeVisible();
  });

  test("名前とドメインを更新し、詳細へ再表示される", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Edit Tenant ${suffix}`;
    const domain = `e2e-edit-${suffix}.localhost`;
    const adminDomain = `admin-e2e-edit-${suffix}.localhost`;

    const tenantId = trackTenant(
      await createTenantViaUi(page, { adminDomain, domain, name })
    );

    const editedName = `${name} (edited)`;
    await tenantNameInput(page).fill(editedName);
    await tenantNameForm(page).getByRole("button", { name: "保存" }).click();
    await expect(formMessage(page)).toContainText("保存しました。");
    // Re-fetch so the server-rendered heading and input defaults match the save.
    await page.goto(platformUrl(`/tenants/${tenantId}`));
    await expect(tenantNameInput(page)).toHaveValue(editedName);
    await expect(
      page.getByRole("heading", { name: `テナント詳細: ${editedName}` })
    ).toBeVisible();

    const newDomain = `e2e-edit2-${suffix}.localhost`;
    const newAdminDomain = `admin-e2e-edit2-${suffix}.localhost`;
    await page.locator("#tenant_domain").fill(newDomain);
    await page.locator("#tenant_admin_domain").fill(newAdminDomain);
    await tenantDomainForm(page).getByRole("button", { name: "保存" }).click();
    await expect(formMessage(page)).toContainText("保存しました。");

    // Reload pins the server-side re-fetch, not just client form state.
    await page.goto(platformUrl(`/tenants/${tenantId}`));
    await expect(tenantNameInput(page)).toHaveValue(editedName);
    await expect(page.locator("#tenant_domain")).toHaveValue(newDomain);
    await expect(page.locator("#tenant_admin_domain")).toHaveValue(
      newAdminDomain
    );
  });

  test("domain / admin_domain が web-host と web-admin のテナント解決へ反映される", async ({
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
      page.getByRole("heading", { level: 1, name: "カタログトップ" })
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
    await expect(page.getByLabel(/メールアドレス/u)).toBeVisible();
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
    await page.locator("#tenant_domain").fill(movedDomain);
    await page.locator("#tenant_admin_domain").fill(movedAdminDomain);
    await tenantDomainForm(page).getByRole("button", { name: "保存" }).click();
    await expect(formMessage(page)).toContainText("保存しました。");

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
    await expect(page.getByLabel(/メールアドレス/u)).toBeVisible();
  });

  test("テナントを停止・再開でき、一覧の状態が更新される", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Status Tenant ${suffix}`;
    const domain = `e2e-status-${suffix}.localhost`;

    const tenantId = trackTenant(
      await createTenantViaUi(page, { domain, name })
    );

    await page.getByRole("button", { name: "停止する" }).click();
    await expect(page.getByRole("button", { name: "再開する" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("停止中").first()).toBeVisible();

    await page.goto(platformUrl("/tenants"));
    await expect(
      page.locator("tr", { hasText: name }).getByText("停止中")
    ).toBeVisible();

    await page.goto(platformUrl(`/tenants/${tenantId}`));
    await page.getByRole("button", { name: "再開する" }).click();
    await expect(page.getByRole("button", { name: "停止する" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("稼働中").first()).toBeVisible();

    await page.goto(platformUrl("/tenants"));
    await expect(
      page.locator("tr", { hasText: name }).getByText("稼働中")
    ).toBeVisible();
  });

  test("主要操作が監査ログに記録される", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Audit Tenant ${suffix}`;
    const domain = `e2e-audit-${suffix}.localhost`;

    const tenantId = trackTenant(
      await createTenantViaUi(page, { domain, name })
    );

    await tenantNameInput(page).fill(`${name} (audited)`);
    await tenantNameForm(page).getByRole("button", { name: "保存" }).click();
    await expect(formMessage(page)).toContainText("保存しました。");

    await page.getByRole("button", { name: "停止する" }).click();
    await expect(page.getByRole("button", { name: "再開する" })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "再開する" }).click();
    await expect(page.getByRole("button", { name: "停止する" })).toBeVisible({
      timeout: 30_000,
    });

    await page.goto(platformUrl("/audit-logs"));
    await expect(page.getByRole("heading", { name: "監査ログ" })).toBeVisible();

    // Recent platform actions for this run should appear as Japanese labels.
    await expect(page.getByText("テナントを作成").first()).toBeVisible();
    await expect(page.getByText("テナント情報を更新").first()).toBeVisible();
    await expect(page.getByText("テナントを停止").first()).toBeVisible();
    await expect(page.getByText("テナントを再開").first()).toBeVisible();

    // Filter by action to pin a specific event type.
    await page.goto(platformUrl("/audit-logs?action=tenant_created"));
    await expect(page.getByText("テナントを作成").first()).toBeVisible();
    await expect(page.locator("table tbody tr").first()).toBeVisible();

    // Detail deep-link still reaches the tenant we just mutated.
    await page.goto(platformUrl(`/tenants/${tenantId}`));
    await expect(
      page.getByRole("heading", { name: `テナント詳細: ${name} (audited)` })
    ).toBeVisible();
  });

  test("権限不足の operator はオペレーター作成を拒否される", async ({
    page,
  }) => {
    applyScenarioSql(PLATFORM_OPERATORS_SCENARIO);

    // Drop super-admin session and sign in as platform_operator.
    await page.goto(platformUrl("/logout"));
    await signInAsScenarioPlatformOperator(page, "/operators/new");

    await expect(
      page.getByRole("heading", { name: /オペレーター/u }).first()
    ).toBeVisible();

    const suffix = uniqueSuffix();
    await page.locator("#operator_name").fill(`Denied Operator ${suffix}`);
    await page.locator("#operator_email").fill(`denied-${suffix}@example.com`);
    // Base UI Select trigger is the only combobox on this form.
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "オペレーター" }).click();
    await page.getByRole("button", { name: "追加" }).click();

    await expect(formMessage(page)).toContainText(
      "この操作を行う権限がありません。"
    );
    // Still on the create form — no redirect to the list.
    await expect(page).toHaveURL(/\/operators\/new/u);
  });

  test("権限不足でもテナント一覧の参照はできる", async ({ page }) => {
    applyScenarioSql(PLATFORM_OPERATORS_SCENARIO);

    const suffix = uniqueSuffix();
    const name = `E2E Visible Tenant ${suffix}`;
    const domain = `e2e-visible-${suffix}.localhost`;
    trackTenant(await createTenantViaUi(page, { domain, name }));

    await page.goto(platformUrl("/logout"));
    await signInAsScenarioPlatformOperator(page, "/tenants");

    await expect(page.getByText(name)).toBeVisible();
    await page
      .locator("tr", { hasText: name })
      .getByRole("link", { name: "詳細" })
      .click();
    await expect(
      page.getByRole("heading", { name: `テナント詳細: ${name}` })
    ).toBeVisible();
  });

  test("必須項目が欠けているとエラーが表示される", async ({ page }) => {
    await page.goto(platformUrl("/tenants/new"));
    await page.locator("#tenant_name").fill(`E2E Invalid ${uniqueSuffix()}`);
    // Leave domain empty — HTML required may block submit; clear via fill and
    // also try submit. If native validation blocks, the test still documents
    // the server-side path when domain is whitespace-only after bypass.
    await page.locator("#tenant_domain").fill("   ");
    await page.getByRole("button", { name: "作成" }).click();

    // Either browser constraint validation keeps us on the form, or the server
    // action returns a Japanese error. Never a successful redirect.
    await expect(page).toHaveURL(/\/tenants\/new/u);
    const domainInput = page.locator("#tenant_domain");
    const validationMessage = await domainInput.evaluate(
      (el: HTMLInputElement) => el.validationMessage
    );
    if (validationMessage) {
      expect(validationMessage.length).toBeGreaterThan(0);
    } else {
      await expect(formMessage(page)).toContainText(
        /テナント名とドメインは必須|必須/u
      );
    }
  });
});
