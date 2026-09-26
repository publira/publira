import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsSeedPlatformSuperAdmin } from "../src/platform";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

const platformUrl = (pathname: string): string =>
  `${WEB_PLATFORM_BASE_URL}${pathname}`;

const sidebarLink = (page: Page, name: string) =>
  page.getByRole("navigation").getByRole("link", { exact: true, name });

/** Each settings entry, where it leads, and the heading that page carries. */
const SETTINGS_PAGES = [
  { heading: "General settings", label: "General", path: "/general" },
  { heading: "Email delivery", label: "Email", path: "/services/email" },
  { heading: "Image storage", label: "Storage", path: "/services/storage" },
  {
    heading: "Browser notifications",
    label: "Web Push",
    path: "/services/webpush",
  },
  { heading: "Security policy", label: "Security", path: "/policies/security" },
  {
    heading: "Community limits",
    label: "Community",
    path: "/policies/community",
  },
  {
    heading: "Retention defaults",
    label: "Retention",
    path: "/policies/retention",
  },
] as const;

/**
 * Where the Platform Console's settings sit: the sidebar groups them by what
 * they configure, each entry opens a page that names itself, and the old
 * `/settings` paths are gone.
 */
test.describe("web-platform console navigation", () => {
  test("the sidebar groups the settings by what they configure", async ({
    page,
  }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/");

    const navigation = page.getByRole("navigation");
    // Section headings are paragraphs; the entries' labels are not.
    await expect(navigation.locator("p")).toHaveText([
      "Tenants",
      "Platform",
      "Services",
      "Policies",
      "Governance",
    ]);
    await expect(navigation.getByRole("link")).toHaveText([
      "Dashboard",
      "Tenants",
      "Create tenant",
      "General",
      "Email",
      "Storage",
      "Web Push",
      "Security",
      "Community",
      "Retention",
      "Operators",
      "Users",
      "Audit logs",
    ]);
  });

  for (const { heading, label, path } of SETTINGS_PAGES) {
    test(`${label} opens ${path}, headed ${heading}`, async ({ page }) => {
      await signInAsSeedPlatformSuperAdmin(page, "/");

      await sidebarLink(page, label).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`, "u"));
      await expect(
        page.getByRole("heading", { level: 1, name: heading })
      ).toBeVisible();
      await expect(sidebarLink(page, label)).toHaveAttribute(
        "aria-current",
        "page"
      );
    });
  }

  test("the operator's own account page marks no sidebar entry", async ({
    page,
  }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/account");

    await expect(
      page.getByRole("heading", { level: 1, name: "Account" })
    ).toBeVisible();
    await expect(
      page.getByRole("navigation").locator('a[aria-current="page"]')
    ).toHaveCount(0);
  });

  for (const path of ["/settings", "/settings/general", "/settings/account"]) {
    test(`the removed ${path} answers not found`, async ({ page }) => {
      await signInAsSeedPlatformSuperAdmin(page, "/");

      const response = await page.goto(platformUrl(path));

      expect(response?.status()).toBe(404);
    });
  }
});
