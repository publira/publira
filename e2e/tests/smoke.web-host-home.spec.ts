import { expect, test } from "@playwright/test";

import { hostPath } from "../src/urls";

/**
 * Minimal host-based routing sample:
 * Host `localhost:3000` resolves to the dev-seed tenant (`localhost` domain)
 * and renders the catalog top page under its prefix-less default locale.
 */
test.describe("web-host catalog top", () => {
  test("seed tenant home is reachable via Host localhost", async ({ page }) => {
    const response = await page.goto(hostPath("/"));
    const content = await page.content();
    expect(response, "navigation should produce a response").not.toBeNull();
    expect(response?.status(), content).toBe(200);

    await expect(
      page.getByRole("heading", { exact: true, name: "Catalog" })
    ).toBeVisible();
    // Seed tenant name (db/seeds/dev/001_tenant_users.sql → "Seed Tenant")
    // Exact match: site chrome may also include the name in nav / footer.
    await expect(
      page.getByRole("paragraph").filter({ hasText: /^Seed Tenant$/u })
    ).toBeVisible();
  });

  test("a URL without a locale is served as the default locale", async ({
    page,
  }) => {
    const response = await page.goto("/series");
    const content = await page.content();

    expect(response?.status(), content).toBe(200);
    await expect(page).toHaveURL(/\/series$/u);
  });
});
