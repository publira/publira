import { expect, test } from "@playwright/test";

import { MISSING_PUBLIC_ID, SEED_TENANT } from "../src/scenarios/multi-tenant";

/**
 * Missing content inside a resolved tenant. Series and episode details render
 * an in-page notice (the site chrome stays usable); the author route has no
 * such notice and answers with the Next.js 404.
 */
test.describe("web-host catalog not found", () => {
  test("存在しないシリーズは案内と一覧への導線を表示する", async ({ page }) => {
    await page.goto(`/series/${MISSING_PUBLIC_ID}`);

    await expect(
      page.getByText("シリーズが見つかりませんでした。")
    ).toBeVisible();
    // `exact`: the breadcrumb above the notice reads "← シリーズ一覧に戻る".
    await expect(
      page.getByRole("link", { exact: true, name: "シリーズ一覧に戻る" })
    ).toBeVisible();
  });

  test("存在しないエピソードは案内とシリーズ詳細への導線を表示する", async ({
    page,
  }) => {
    await page.goto(
      `/series/${SEED_TENANT.series.publicId}/episodes/${MISSING_PUBLIC_ID}`
    );

    await expect(
      page.getByText("エピソードが見つかりませんでした。")
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "シリーズ詳細に戻る" })
    ).toBeVisible();
  });

  test("別シリーズのエピソード ID は見つからない", async ({ page }) => {
    await page.goto(
      `/series/${MISSING_PUBLIC_ID}/episodes/${SEED_TENANT.series.freeEpisodeId}`
    );

    await expect(
      page.getByText("エピソードが見つかりませんでした。")
    ).toBeVisible();
    await expect(
      page.getByText(SEED_TENANT.series.freeEpisodeTitle)
    ).toHaveCount(0);
  });

  test("存在しない著者は 404", async ({ page }) => {
    const response = await page.goto(`/authors/${MISSING_PUBLIC_ID}`);

    expect(response?.status(), await page.content()).toBe(404);
  });
});
