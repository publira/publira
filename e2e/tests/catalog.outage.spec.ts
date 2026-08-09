import { expect, test } from "@playwright/test";

import { startApiServer, stopApiServer } from "../src/api-server";
import { uncachedTenantBaseUrl } from "../src/urls";

/**
 * Public API outage. Tenant resolution is the first backend call every request
 * makes, so it is where an unreachable API has to degrade predictably: 503 with
 * `Retry-After`, never a tenant mix-up and never a hang.
 *
 * Each navigation uses a Host that has never been resolved before, so
 * web-host's in-process tenant cache cannot answer it.
 */
test.describe("web-host public API outage", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    stopApiServer();
  });

  test.afterAll(() => {
    startApiServer();
  });

  test("テナント解決できない間は 503 と Retry-After を返す", async ({
    page,
  }) => {
    const response = await page.goto(`${uncachedTenantBaseUrl()}/`);

    expect(response?.status(), await page.content()).toBe(503);
    expect(response?.headers()["retry-after"]).toBe("30");
  });

  test("復旧後は同じ導線が通常どおり応答する", async ({ page }) => {
    startApiServer();

    const response = await page.goto("/");
    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "カタログトップ" })
    ).toBeVisible();
  });
});
