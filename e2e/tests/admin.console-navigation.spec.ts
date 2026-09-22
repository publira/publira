import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";

const sidebarLink = (page: Page, name: string) =>
  page.getByRole("navigation").getByRole("link", { exact: true, name });

/**
 * Where each console screen sits: a list managed like Genres, the tenant's
 * branding, and the outside services it connects to each have a sidebar entry,
 * the royalty close settings are reached from Royalties, and Settings keeps only
 * the tenant-wide settings.
 */
test.describe("web-admin console navigation", () => {
  test("the sidebar places each screen with the work it belongs to", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/");

    await expect(page.getByRole("navigation").getByRole("link")).toHaveText([
      "Dashboard",
      "Labels",
      "Authors",
      "Genres",
      "Author roles",
      "Series",
      "Pages",
      "Announcements",
      "Access tickets",
      // The pending-comment badge rides on this entry.
      /^Comments/u,
      "Readers",
      "Contact messages",
      "Read-through",
      "Royalties",
      "Members",
      "Branding",
      "Integrations",
      "Audit logs",
      "Settings",
    ]);
  });

  test("Author roles, Branding, and Integrations open from the sidebar", async ({
    page,
  }) => {
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

    await sidebarLink(page, "Integrations").click();
    await expect(page).toHaveURL(/\/integrations\/email$/u);
    await expect(
      page.getByRole("heading", { level: 1, name: "Integrations" })
    ).toBeVisible();
    await expect(sidebarLink(page, "Integrations")).toHaveAttribute(
      "aria-current",
      "page"
    );

    await page.getByRole("link", { exact: true, name: "App links" }).click();
    await expect(page).toHaveURL(/\/integrations\/app-links$/u);
    await expect(sidebarLink(page, "Integrations")).toHaveAttribute(
      "aria-current",
      "page"
    );
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
