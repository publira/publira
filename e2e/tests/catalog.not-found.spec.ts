import { expect, test } from "@playwright/test";

import { MISSING_PUBLIC_ID, SEED_TENANT } from "../src/scenarios/multi-tenant";
import { hostPath } from "../src/urls";

/**
 * Missing content inside a resolved tenant. Every route renders
 * `app/[tenant_id]/(site)/not-found.tsx`, so the tenant header and footer stay
 * usable and the copy never says which of "absent", "unpublished" or "another
 * tenant's" applies (#643).
 *
 * The response carries HTTP 200, not 404: these routes read their record inside
 * `<Suspense>` so the route keeps a static shell, and by the time `notFound()`
 * runs the shell has been committed with a 200 (#672). What the reader sees is
 * unchanged; what a crawler sees is not, and restoring the status needs a
 * mechanism that decides it before the first byte.
 */
test.describe("web-host catalog not found", () => {
  test("存在しないシリーズはサイト UI を保った案内を表示する", async ({
    page,
  }) => {
    const response = await page.goto(hostPath(`/series/${MISSING_PUBLIC_ID}`));

    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();
    // Site chrome survives the 404: the header nav is still there.
    await expect(
      page.getByRole("link", { exact: true, name: "シリーズ" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { exact: true, name: "シリーズ一覧へ" })
    ).toBeVisible();
  });

  test("存在しないエピソードは見つからない案内を表示する", async ({ page }) => {
    const response = await page.goto(
      hostPath(
        `/series/${SEED_TENANT.series.publicId}/episodes/${MISSING_PUBLIC_ID}`
      )
    );

    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();
  });

  test("別シリーズのエピソード ID は見つからない", async ({ page }) => {
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

  test("public_id は大文字小文字を区別する", async ({ page }) => {
    // Base58 uses both cases, so a case-folded lookup would resolve two
    // different IDs to the same record (#673).
    const response = await page.goto(
      hostPath(`/series/${SEED_TENANT.series.publicId.toUpperCase()}`)
    );

    expect(response?.status(), await page.content()).toBe(200);
    await expect(page.getByText(SEED_TENANT.series.title)).toHaveCount(0);
  });

  test("存在しないレーベルは見つからない案内を表示する", async ({ page }) => {
    const response = await page.goto(hostPath(`/labels/${MISSING_PUBLIC_ID}`));

    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();
  });

  test("存在しない著者は見つからない案内を表示する", async ({ page }) => {
    const response = await page.goto(hostPath(`/authors/${MISSING_PUBLIC_ID}`));

    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();
  });

  test("存在しない公開ページは見つからない案内を表示する", async ({ page }) => {
    const response = await page.goto(hostPath("/page/no-such-published-page"));

    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();
  });
});
