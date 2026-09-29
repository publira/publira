import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";

const sidebarLink = (page: Page, name: string) =>
  page.getByRole("navigation").getByRole("link", { exact: true, name });

/**
 * Opens an integration from its sidebar entry and checks that the entry is
 * the current page and that the page offers no tab row to the others.
 */
const expectIntegrationOpens = async (
  page: Page,
  label: string,
  path: string
) => {
  await sidebarLink(page, label).click();
  await expect(page).toHaveURL(new RegExp(`/integrations/${path}$`, "u"));
  await expect(
    page.getByRole("heading", {
      exact: true,
      level: 1,
      name: `Integrations — ${label}`,
    })
  ).toBeVisible();
  await expect(sidebarLink(page, label)).toHaveAttribute(
    "aria-current",
    "page"
  );
  await expect(
    page.getByRole("main").getByRole("link", { exact: true, name: label })
  ).toHaveCount(0);
};

/**
 * Where each console screen sits: the sidebar groups its entries by kind of
 * work, a list managed like Genres, the tenant's branding, and the outside
 * services it connects to each have an entry, the royalty close settings are
 * reached from Royalties, and Settings keeps only the tenant-wide settings.
 */
test.describe("web-admin console navigation", () => {
  test("the sidebar places each screen with the work it belongs to", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/");

    const navigation = page.getByRole("navigation");
    // Section headings are paragraphs; the entries' labels are not.
    await expect(navigation.locator("p")).toHaveText([
      "Catalog",
      "Site",
      "Readers",
      "Reports",
      "Integrations",
      "Administration",
    ]);
    await expect(navigation.getByRole("link")).toHaveText([
      "Dashboard",
      "Series",
      "Labels",
      "Authors",
      "Author roles",
      "Genres",
      "Pages",
      "Announcements",
      "Readers",
      // The pending-comment badge rides on this entry.
      /^Comments/u,
      "Contact messages",
      "Access tickets",
      "Read-through",
      "Royalties",
      "Email",
      "Payments",
      "Mobile push",
      "App links",
      "Sign-in",
      "Members",
      "Branding",
      "Audit logs",
      "Settings",
    ]);
  });

  test("Author roles and Branding open from the sidebar", async ({ page }) => {
    await signInAsSeedAdmin(page, "/");

    await sidebarLink(page, "Author roles").click();
    await expect(page).toHaveURL(/\/creator-roles$/u);
    await expect(
      page.getByRole("heading", { level: 1, name: "Author roles" })
    ).toBeVisible();

    await sidebarLink(page, "Branding").click();
    await expect(page).toHaveURL(/\/branding$/u);
    await expect(
      page.getByRole("heading", { level: 1, name: "Branding" })
    ).toBeVisible();
  });

  test("every integration opens from its own sidebar entry, with no tab row", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/");

    await expectIntegrationOpens(page, "Email", "email");
    await expectIntegrationOpens(page, "Payments", "payment");
    await expectIntegrationOpens(page, "Mobile push", "mobile-push");
    await expectIntegrationOpens(page, "App links", "app-links");
    await expectIntegrationOpens(page, "Sign-in", "sign-in");
  });

  test("the retired integrations landing path answers not found", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/");

    const response = await page.goto("/integrations");

    expect(response?.status()).toBe(404);
  });

  test("on a phone, the drawer lists the sidebar and closes on the entry followed", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await signInAsSeedAdmin(page, "/");

    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog");
    await expect(
      drawer.getByRole("link", { exact: true, name: "Dashboard" })
    ).toHaveAttribute("aria-current", "page");

    await drawer.getByRole("link", { exact: true, name: "Branding" }).click();
    await expect(page).toHaveURL(/\/branding$/u);
    await expect(drawer).toBeHidden();
    await expect(
      page.getByRole("heading", { level: 1, name: "Branding" })
    ).toBeVisible();
  });

  test("Settings holds the tenant-wide settings only", async ({ page }) => {
    await signInAsSeedAdmin(page, "/settings");

    const main = page.getByRole("main");
    await expect(
      main.getByRole("link", { exact: true, name: "General" })
    ).toBeVisible();
    await expect(
      main.getByRole("link", { exact: true, name: "Limits and retention" })
    ).toBeVisible();
    await Promise.all(
      ["Author roles", "Theme", "Email", "Royalties"].map((moved) =>
        expect(
          main.getByRole("link", { exact: true, name: moved })
        ).toHaveCount(0)
      )
    );
  });

  test("a removed Settings path answers not found", async ({ page }) => {
    await signInAsSeedAdmin(page, "/");

    const response = await page.goto("/settings/theme");

    expect(response?.status()).toBe(404);
  });
});
