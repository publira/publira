import { expect, test } from "@playwright/test";

import { seriesFormFields, signInAsSeedAdmin } from "../src/admin";
import { expectNoticeClearOf, goOfflineAndBack } from "../src/offline";

test.describe("web-admin connectivity notice", () => {
  test("appears on the sign-in screen while offline and clears on reconnect", async ({
    page,
  }) => {
    await page.goto("/login");
    const submit = page.getByRole("button", { name: "Sign in" });
    await expect(submit).toBeVisible();

    await goOfflineAndBack(page, () => expectNoticeClearOf(page, submit));
  });

  test("leaves an operator mid-form where they were", async ({ page }) => {
    await signInAsSeedAdmin(page, "/series/new");
    const { title } = seriesFormFields(page);
    await title.fill("Offline draft");
    await title.focus();
    const submit = page.getByRole("button", { name: "Create series" });

    await goOfflineAndBack(page, () => expectNoticeClearOf(page, submit));

    await expect(title).toBeFocused();
    await expect(title).toHaveValue("Offline draft");
  });
});
