import { expect, test } from "@playwright/test";

import { expectNothingAnimates } from "../src/motion";
import { storefrontPath } from "../src/urls";

/**
 * A reader who has asked their platform for less motion gets a public site
 * that holds still. The rule that answers the preference is a base rule of
 * `@publira/layouts/styles.css`, so what is checked is the whole page rather
 * than the elements one screen happens to animate.
 */
test.describe("web-storefront under reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("nothing on the catalog top page animates", async ({ page }) => {
    await page.goto(storefrontPath("/"));

    await expect(
      page.getByRole("heading", { level: 2, name: "New episodes" })
    ).toBeVisible();
    await expectNothingAnimates(page);
  });
});
