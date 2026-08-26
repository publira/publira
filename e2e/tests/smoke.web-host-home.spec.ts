import { expect, test } from "@playwright/test";

import { hostPath, WEB_HOST_LOCALE } from "../src/urls";

/**
 * Minimal host-based routing sample:
 * Host `localhost:3000` resolves to the dev-seed tenant (`localhost` domain)
 * and renders the catalog top page under the locale prefix.
 */
test.describe("web-host catalog top", () => {
  test("seed tenant home is reachable via Host localhost", async ({ page }) => {
    const response = await page.goto(hostPath("/"));
    expect(response, "navigation should produce a response").not.toBeNull();
    expect(response?.status(), await page.content()).toBe(200);

    await expect(
      page.getByRole("heading", { name: "カタログトップ" })
    ).toBeVisible();
    // Seed tenant name (db/seeds/dev/001_tenant_users.sql → "Seed Tenant")
    // Exact match: site chrome may also include the name in nav / footer.
    await expect(
      page.getByRole("paragraph").filter({ hasText: /^Seed Tenant$/u })
    ).toBeVisible();
  });

  // Bookmarks predate the locale prefix (#869), so a locale-less URL has to
  // land on the same page rather than 404.
  test("locale の無い URL は既定 locale へ送られる", async ({ page }) => {
    const response = await page.goto("/series");

    expect(response?.status(), await page.content()).toBe(200);
    await expect(page).toHaveURL(
      new RegExp(`/${WEB_HOST_LOCALE}/series$`, "u")
    );
  });
});
