import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import {
  SCENARIO_PLATFORM_OPERATOR,
  SEED_PLATFORM_SUPER_ADMIN,
} from "./scenarios/platform-tenants";
import { fillLoginForm } from "./session";
import { WEB_PLATFORM_BASE_URL } from "./urls";

const platformUrl = (pathname: string): string =>
  `${WEB_PLATFORM_BASE_URL}${pathname}`;

export const signInAsPlatformOperator = async (
  page: Page,
  credentials: { email: string; password: string } = SEED_PLATFORM_SUPER_ADMIN,
  nextPath = "/tenants"
): Promise<void> => {
  const next = encodeURIComponent(nextPath);
  await page.goto(platformUrl(`/login?next=${next}`));
  await fillLoginForm(page, credentials);
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
};

export const signInAsSeedPlatformSuperAdmin = async (
  page: Page,
  nextPath = "/tenants"
): Promise<void> => {
  await signInAsPlatformOperator(page, SEED_PLATFORM_SUPER_ADMIN, nextPath);
};

export const signInAsScenarioPlatformOperator = async (
  page: Page,
  nextPath = "/tenants"
): Promise<void> => {
  await signInAsPlatformOperator(page, SCENARIO_PLATFORM_OPERATOR, nextPath);
};

/** Open the console header's user menu (avatar). */
export const openPlatformUserMenu = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "アカウントメニュー" }).click();
};

export const signOutPlatform = async (page: Page): Promise<void> => {
  await openPlatformUserMenu(page);
  await page.getByRole("menuitem", { name: "ログアウト" }).click();
  await page.waitForURL((url) => url.pathname.endsWith("/login"));
};

export interface CreateTenantInput {
  name: string;
  domain: string;
  adminDomain?: string;
  initialAdminEmails?: string;
  /**
   * Label of the option to pick in the default-language selector.
   *
   * The form opens on whatever `Accept-Language` asks for, which is
   * `English` under Playwright's Chromium. Every assertion this suite makes on
   * a tenant-owned screen — the web-host catalog, the tenant's web-admin login
   * — is written against the Japanese copy, so the helper picks `日本語`
   * unless a test says otherwise.
   */
  defaultLocaleLabel?: "English" | "日本語";
}

/**
 * Fill and submit the tenant create form. Resolves after redirect to the
 * detail URL (`/tenants/<publicId>`).
 */
export const createTenantViaUi = async (
  page: Page,
  input: CreateTenantInput
): Promise<string> => {
  await page.goto(platformUrl("/tenants/new"));
  await expect(
    page.getByRole("heading", { name: /テナント/u }).first()
  ).toBeVisible();

  await page.locator("#tenant_name").fill(input.name);
  await page.locator("#tenant_domain").fill(input.domain);
  await page.locator("#tenant_default_locale").click();
  await page
    .getByRole("option", { name: input.defaultLocaleLabel ?? "日本語" })
    .click();
  if (input.adminDomain !== undefined) {
    await page.locator("#tenant_admin_domain").fill(input.adminDomain);
  }
  if (input.initialAdminEmails !== undefined) {
    await page.locator("#initial_admin_emails").fill(input.initialAdminEmails);
  }

  await page.getByRole("button", { name: "作成" }).click();
  await page.waitForURL((url) => {
    const match = url.pathname.match(/^\/tenants\/(?<publicId>[^/]+)(?:\/|$)/u);
    const publicId = match?.groups?.publicId;
    return Boolean(publicId && publicId !== "new");
  });

  const match = page.url().match(/\/tenants\/(?<publicId>[^/?#]+)/u);
  const publicId = match?.groups?.publicId?.trim() ?? "";
  if (!publicId || publicId === "new") {
    throw new Error(`could not parse tenant public id from ${page.url()}`);
  }
  return publicId;
};

export const formMessage = (page: Page): Locator => page.getByRole("status");
