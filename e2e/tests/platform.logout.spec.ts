import { expect, test } from "@playwright/test";

import { signInAsSeedPlatformSuperAdmin } from "../src/platform";
import {
  PLATFORM_SESSION_COOKIE_NAME,
  sessionCookieValue,
} from "../src/session";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

const platformUrl = (pathname: string): string =>
  `${WEB_PLATFORM_BASE_URL}${pathname}`;

const currentSession = async (
  page: Parameters<typeof signInAsSeedPlatformSuperAdmin>[0]
): Promise<string | undefined> =>
  sessionCookieValue(
    await page.context().cookies(),
    PLATFORM_SESSION_COOKIE_NAME
  );

/**
 * GET /logout must not be a logout (forced-logout CSRF). The route is gone;
 * proxy answers 404 and leaves the session cookie alone (#655).
 */
test.describe("platform GET /logout", () => {
  test("認証済み GET は 404 でセッションを維持する", async ({ page }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/tenants");

    const before = await currentSession(page);
    expect(before).toBeTruthy();

    const response = await page.request.get(platformUrl("/logout"));
    expect(response.status()).toBe(404);
    expect(response.headers()["set-cookie"] ?? "").not.toContain(
      PLATFORM_SESSION_COOKIE_NAME
    );

    expect(await currentSession(page)).toBe(before);

    await page.goto(platformUrl("/tenants"));
    await expect(
      page.getByRole("heading", { name: /テナント/u }).first()
    ).toBeVisible();
  });

  test("未認証 GET は 404 で Cookie を発行しない", async ({ request }) => {
    const response = await request.get(platformUrl("/logout"));
    expect(response.status()).toBe(404);
    expect(response.headers()["set-cookie"] ?? "").not.toContain(
      PLATFORM_SESSION_COOKIE_NAME
    );
  });

  test("クロスサイト GET でもセッションを消さない", async ({ page }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/tenants");

    const before = await currentSession(page);
    expect(before).toBeTruthy();

    const response = await page.request.get(platformUrl("/logout"), {
      headers: {
        Origin: "https://evil.example",
        Referer: "https://evil.example/attack",
      },
    });
    expect(response.status()).toBe(404);
    expect(response.headers()["set-cookie"] ?? "").not.toContain(
      PLATFORM_SESSION_COOKIE_NAME
    );

    expect(await currentSession(page)).toBe(before);

    await page.goto(platformUrl("/tenants"));
    await expect(
      page.getByRole("heading", { name: /テナント/u }).first()
    ).toBeVisible();
  });
});
