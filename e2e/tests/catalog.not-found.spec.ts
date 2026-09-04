import { expect, test } from "@playwright/test";

import { MISSING_PUBLIC_ID, SEED_TENANT } from "../src/scenarios/multi-tenant";
import { hostPath } from "../src/urls";

/**
 * Missing content inside a resolved tenant. Every route renders
 * `app/[tenant_id]/(site)/not-found.tsx`, so the tenant header and footer stay
 * usable and the copy never says which of "absent", "unpublished" or "another
 * tenant's" applies.
 *
 * The response carries HTTP 200, not 404: these routes read their record inside
 * `<Suspense>` so the route keeps a static shell, and by the time `notFound()`
 * runs the shell has been committed with a 200. What the reader sees is
 * unchanged; what a crawler sees is not, and restoring the status needs a
 * mechanism that decides it before the first byte.
 */
test.describe("web-host catalog not found", () => {
  test("a missing series shows the not-found page with the site UI intact", async ({
    page,
  }) => {
    const response = await page.goto(hostPath(`/series/${MISSING_PUBLIC_ID}`));

    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" })
    ).toBeVisible();
    // Site chrome survives the 404: the header nav is still there.
    await expect(
      page.getByRole("link", { exact: true, name: "Series" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { exact: true, name: "Browse series" })
    ).toBeVisible();
  });

  test("a missing episode shows the not-found page", async ({ page }) => {
    const response = await page.goto(
      hostPath(
        `/series/${SEED_TENANT.series.publicId}/episodes/${MISSING_PUBLIC_ID}`
      )
    );

    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" })
    ).toBeVisible();
  });

  test("an episode id from another series is not found", async ({ page }) => {
    const response = await page.goto(
      hostPath(
        `/series/${MISSING_PUBLIC_ID}/episodes/${SEED_TENANT.series.freeEpisodeId}`
      )
    );

    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByText(SEED_TENANT.series.freeEpisodeTitle)
    ).toHaveCount(0);
  });

  test("public_id is case-sensitive", async ({ page }) => {
    // Base58 uses both cases, so a case-folded lookup would resolve two
    // different IDs to the same record.
    const response = await page.goto(
      hostPath(`/series/${SEED_TENANT.series.publicId.toUpperCase()}`)
    );

    expect(response?.status(), await page.content()).toBe(200);
    await expect(page.getByText(SEED_TENANT.series.title)).toHaveCount(0);
  });

  test("a missing label shows the not-found page", async ({ page }) => {
    const response = await page.goto(hostPath(`/labels/${MISSING_PUBLIC_ID}`));

    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" })
    ).toBeVisible();
  });

  test("a missing author shows the not-found page", async ({ page }) => {
    const response = await page.goto(hostPath(`/authors/${MISSING_PUBLIC_ID}`));

    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" })
    ).toBeVisible();
  });

  test("a missing published page shows the not-found page", async ({
    page,
  }) => {
    const response = await page.goto(hostPath("/page/no-such-published-page"));

    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "Page not found" })
    ).toBeVisible();
  });
});
