import { expect, test } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";

/**
 * The dialog that edits the credits of many episodes at once, on the seed
 * tenant's series. It is opened and left unsubmitted, so nothing is saved.
 */
test.describe("admin episode credits dialog", () => {
  test("covers the rows scrolled under its footer down to the dialog's edge", async ({
    page,
  }) => {
    await signInAsSeedAdmin(
      page,
      `/series/${SEED_TENANT.series.publicId}/episodes`
    );
    await page.getByRole("button", { exact: true, name: "Credits" }).click();

    const dialog = page.getByRole("dialog", {
      name: "Edit credits on selected episodes",
    });
    const apply = dialog.getByRole("button", { exact: true, name: "Apply" });
    await expect(apply).toBeVisible();
    // The episode checklist arrives after the dialog opens, and is what makes
    // the dialog taller than it is allowed to be.
    await expect
      .poll(() =>
        dialog.evaluate(
          (element) => element.scrollHeight > element.clientHeight
        )
      )
      .toBe(true);
    // The popup grows into place as it opens, and a point measured on the
    // way lands outside it.
    await dialog.evaluate((element) =>
      Promise.all(
        element.getAnimations().map((animation) => animation.finished)
      )
    );

    // The scroll positions, as a share of the way down, at which something
    // other than the footer is drawn just above the dialog's bottom edge.
    const uncovered = await apply.evaluate((button) => {
      const scroller = button.closest('[role="dialog"]');
      const footer = button.parentElement;
      if (!(scroller && footer)) {
        return ["no dialog"];
      }
      return ["0", "0.5", "1"].filter((position) => {
        scroller.scrollTop =
          (scroller.scrollHeight - scroller.clientHeight) * Number(position);
        const box = scroller.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + scroller.clientTop + scroller.clientHeight - 1
        );
        return !(hit && footer.contains(hit));
      });
    });
    expect(uncovered).toEqual([]);
  });
});
