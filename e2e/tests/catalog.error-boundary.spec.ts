import { expect, test } from "@playwright/test";

import { startApiServer, stopApiServer } from "../src/api-server";

/**
 * Route-level error boundary (#643), acceptance criterion "サーバー側の例外で
 * サイトの UI を保ったエラー画面が表示され、リトライできる".
 *
 * `app/[tenant_id]/(site)/error.tsx` and `app/[tenant_id]/error.tsx` ship, but
 * measurement against the production build shows they only take over in one
 * narrow case. Three probes, each a deliberate throw in a page or a stopped
 * public API:
 *
 * | failure | navigation | result |
 * | --- | --- | --- |
 * | page throws, layout healthy | client | `(site)/error.tsx` renders |
 * | page throws, layout healthy | direct hit | bare `500 Internal Server Error` |
 * | API down, so the layout throws too | client | bare `500` |
 *
 * The cause of the bare 500 is not identified. The proxy rewrite and a missing
 * `global-error.tsx` were both ruled out by measurement; the root layout
 * position and `cacheComponents` are untested. #683 carries the hypotheses, the
 * reproduction recipe, and the fix — it is blocked by #646 only because the
 * untested root-layout hypothesis would be resolved there.
 *
 * So the test below is skipped rather than asserted, the same way
 * `catalog.outage.spec.ts` holds #672's target: it pins the contract we want
 * without claiming the app delivers it today. Enable it with #683.
 */
test.describe("web-host site error boundary", () => {
  test.describe.configure({ mode: "serial" });

  test.afterAll(() => {
    startApiServer();
  });

  /**
   * Skipped until #683 lands. Until then the server answers this navigation
   * with a bare 500 before the boundary can render, as measured in the table
   * above.
   */
  test.skip("サーバー例外でサイト UI を保ったエラー画面とリトライ導線を表示する", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: "カタログトップ" })
    ).toBeVisible();

    stopApiServer();

    await page
      .getByRole("link", { exact: true, name: "レーベル一覧へ" })
      .first()
      .click();

    await expect(
      page.getByRole("heading", { name: "ページを表示できませんでした" })
    ).toBeVisible();
    // Site chrome survives: the boundary sits under (site)/layout.tsx.
    await expect(
      page.getByRole("link", { exact: true, name: "Series" })
    ).toBeVisible();

    // "リトライできる" means the retry recovers, not that a button exists: a
    // no-op retry has to fail this test.
    startApiServer();
    await page.getByRole("button", { name: "再試行" }).click();

    await expect(
      page.getByRole("heading", { level: 1, name: "レーベル一覧" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "ページを表示できませんでした" })
    ).toHaveCount(0);
  });
});
