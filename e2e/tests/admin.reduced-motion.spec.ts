import { expect, test } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";
import { expectNothingAnimates } from "../src/motion";

/**
 * The same base rule as the public site, on the console shell the two
 * consoles share: an editor who has asked for less motion gets a workbench
 * that holds still.
 */
test.describe("web-admin under reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("nothing on the series list animates", async ({ page }) => {
    await signInAsSeedAdmin(page, "/series");

    await expect(
      page.getByRole("heading", { level: 1, name: "Series" })
    ).toBeVisible();
    await expectNothingAnimates(page);
  });
});
