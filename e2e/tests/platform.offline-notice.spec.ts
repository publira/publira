import { expect, test } from "@playwright/test";

import { expectNoticeClearOf, goOfflineAndBack } from "../src/offline";
import { signInAsSeedPlatformSuperAdmin } from "../src/platform";

test.describe("web-platform connectivity notice", () => {
  test("appears on the sign-in screen while offline and clears on reconnect", async ({
    page,
  }) => {
    await page.goto("/login");
    const submit = page.getByRole("button", { name: "Sign in" });
    await expect(submit).toBeVisible();

    await goOfflineAndBack(page, () => expectNoticeClearOf(page, submit));
  });

  test("leaves an operator mid-form where they were", async ({ page }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/tenants/new");
    const name = page.getByRole("textbox", { name: /^Tenant name/u });
    await name.fill("Offline draft");
    await name.focus();
    const submit = page.getByRole("button", { name: "Create" });

    await goOfflineAndBack(page, () => expectNoticeClearOf(page, submit));

    await expect(name).toBeFocused();
    await expect(name).toHaveValue("Offline draft");
  });
});
