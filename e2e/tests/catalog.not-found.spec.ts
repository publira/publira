import { expect, test } from "@playwright/test";

import { MISSING_PUBLIC_ID, SEED_TENANT } from "../src/scenarios/multi-tenant";

/**
 * Missing content inside a resolved tenant. Every route answers with an HTTP
 * 404 rendered by `app/[tenant_id]/(site)/not-found.tsx`, so the tenant header
 * and footer stay usable and the copy never says which of "absent",
 * "unpublished" or "another tenant's" applies (#643).
 */
test.describe("web-host catalog not found", () => {
  test("存在しないシリーズは 404 とサイト UI を保った案内を表示する", async ({
    page,
  }) => {
    const response = await page.goto(`/series/${MISSING_PUBLIC_ID}`);

    expect(response?.status(), await page.content()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();
    // Site chrome survives the 404: the header nav is still there.
    await expect(
      page.getByRole("link", { exact: true, name: "Series" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { exact: true, name: "シリーズ一覧へ" })
    ).toBeVisible();
  });

  test("存在しないエピソードは 404", async ({ page }) => {
    const response = await page.goto(
      `/series/${SEED_TENANT.series.publicId}/episodes/${MISSING_PUBLIC_ID}`
    );

    expect(response?.status(), await page.content()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();
  });

  test("別シリーズのエピソード ID は見つからない", async ({ page }) => {
    const response = await page.goto(
      `/series/${MISSING_PUBLIC_ID}/episodes/${SEED_TENANT.series.freeEpisodeId}`
    );

    expect(response?.status(), await page.content()).toBe(404);
    await expect(
      page.getByText(SEED_TENANT.series.freeEpisodeTitle)
    ).toHaveCount(0);
  });

  test("public_id は大文字小文字を区別する", async ({ page }) => {
    // Base58 uses both cases, so a case-folded lookup would resolve two
    // different IDs to the same record (#673).
    const response = await page.goto(
      `/series/${SEED_TENANT.series.publicId.toUpperCase()}`
    );

    expect(response?.status(), await page.content()).toBe(404);
    await expect(page.getByText(SEED_TENANT.series.title)).toHaveCount(0);
  });

  test("存在しない著者は 404", async ({ page }) => {
    const response = await page.goto(`/authors/${MISSING_PUBLIC_ID}`);

    expect(response?.status(), await page.content()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();
  });

  test("存在しない公開ページは 404", async ({ page }) => {
    const response = await page.goto("/page/no-such-published-page");

    expect(response?.status(), await page.content()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();
  });
});
