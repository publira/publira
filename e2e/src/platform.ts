import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import type { LocaleLabel } from "./locale";
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
  await page.getByRole("button", { name: "Account menu" }).click();
};

export const signOutPlatform = async (page: Page): Promise<void> => {
  await openPlatformUserMenu(page);
  await page.getByRole("menuitem", { name: "Sign out" }).click();
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
   * Every assertion this suite makes on a tenant-owned screen — the web-host
   * catalog, the tenant's web-admin login — is written against the English
   * copy, so the helper picks `English` unless a test says otherwise.
   */
  defaultLocaleLabel?: LocaleLabel;
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
    page.getByRole("heading", { name: /Create tenant/u }).first()
  ).toBeVisible();

  await page.getByRole("textbox", { name: /^Tenant name/u }).fill(input.name);
  await page.getByRole("textbox", { name: /^Domain/u }).fill(input.domain);
  await page.getByRole("combobox", { name: /^Default language/u }).click();
  await page
    .getByRole("option", { name: input.defaultLocaleLabel ?? "English" })
    .click();
  if (input.adminDomain !== undefined) {
    await page
      .getByRole("textbox", { name: /^Admin domain/u })
      .fill(input.adminDomain);
  }
  if (input.initialAdminEmails !== undefined) {
    await page
      .getByRole("textbox", { name: /^Initial admin emails/u })
      .fill(input.initialAdminEmails);
  }

  await page.getByRole("button", { name: "Create" }).click();
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

/** Label of the option to pick in an operator role selector. */
export type OperatorRoleLabel = "Auditor" | "Operator" | "Super admin";

export interface CreateOperatorInput {
  email: string;
  name: string;
  roleLabel: OperatorRoleLabel;
}

/**
 * Fill and submit the operator create form, resolving after the redirect back
 * to the list.
 *
 * The invited operator's public_id is not on that redirect and the Action
 * answers with nothing else, so a caller that needs it reads the row it created.
 */
export const createOperatorViaUi = async (
  page: Page,
  input: CreateOperatorInput
): Promise<void> => {
  await page.goto(platformUrl("/operators/new"));
  await page.getByRole("textbox", { name: /^Name/u }).fill(input.name);
  await page
    .getByRole("textbox", { name: /^Email address/u })
    .fill(input.email);
  // Base UI Select trigger is the only combobox on this form.
  await page.getByRole("combobox").click();
  await page
    .getByRole("option", { exact: true, name: input.roleLabel })
    .click();
  await page.getByRole("button", { name: "Add" }).click();
  await page.waitForURL((url) => url.pathname === "/operators");
};

/**
 * Open the `ConfirmDialog` a destructive console action sits behind and run it.
 *
 * The trigger and the confirmation do not always carry the same label, so both
 * are named by the caller rather than derived from one another.
 */
export const confirmDangerAction = async (
  page: Page,
  triggerLabel: string,
  confirmLabel: string
): Promise<void> => {
  await page.getByRole("button", { exact: true, name: triggerLabel }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { exact: true, name: confirmLabel }).click();
};
