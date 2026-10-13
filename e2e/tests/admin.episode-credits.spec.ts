import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { signInAsSeedAdmin } from "../src/admin";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";

/**
 * Opens the dialog that edits the credits of many episodes at once, on the
 * seed tenant's series, and returns its Apply button once the dialog is laid
 * out the way it stays. The dialog is left unsubmitted, so nothing is saved.
 */
const openCreditsDialog = async (page: Page): Promise<Locator> => {
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
  await expect(
    dialog.getByRole("checkbox", { name: /Seed Episode 001-01/u })
  ).toBeAttached();
  // The popup grows into place as it opens, and a point measured on the
  // way lands outside it.
  await dialog.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished))
  );
  return apply;
};

test.describe("admin episode credits dialog", () => {
  test("shows none of the scrolled rows below its footer", async ({ page }) => {
    const apply = await openCreditsDialog(page);

    // The scroll positions, as a share of the way down, at which a row of the
    // scrolled body is drawn just above the dialog's bottom edge.
    const uncovered = await apply.evaluate((button) => {
      const popup = button.closest('[role="dialog"]');
      const body = button.parentElement?.previousElementSibling;
      if (!(popup && body && body.scrollHeight > body.clientHeight)) {
        return ["no scrolled body"];
      }
      return ["0", "0.5", "1"].filter((position) => {
        body.scrollTop =
          (body.scrollHeight - body.clientHeight) * Number(position);
        const box = popup.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.bottom - popup.clientTop - 1
        );
        return !hit || body.contains(hit);
      });
    });
    expect(uncovered).toEqual([]);
  });

  // The footer's buttons sit in a row at the first size and stack at the
  // second, which makes the footer taller. The third is a page zoomed to 400%
  // on a 1280×1024 screen, too short for the body to scroll between the
  // header and the footer.
  for (const viewport of [
    { height: 900, width: 1280 },
    { height: 844, width: 390 },
    { height: 256, width: 320 },
  ]) {
    const size = `${viewport.width}×${viewport.height}`;

    test(`keeps the control Tab moves to in view above its footer at ${size}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      const apply = await openCreditsDialog(page);

      // Focus is trapped in the dialog, so Tab comes back round to a control
      // it has already been on. Each control outside the footer is listed
      // with how far it reaches past the footer's top edge or out of the
      // popup, and the list stays empty while none does.
      const tabThrough = async (
        visited: number,
        outOfView: readonly string[]
      ): Promise<{ outOfView: readonly string[]; visited: number }> => {
        await page.keyboard.press("Tab");
        const focused = await apply.evaluate((button) => {
          const footer = button.parentElement;
          const popup = button.closest('[role="dialog"]');
          const element = document.activeElement;
          if (
            !(footer && popup && element instanceof HTMLElement) ||
            "e2eSeen" in element.dataset
          ) {
            return null;
          }
          element.dataset.e2eSeen = "";
          // Focus passes over the document itself on its way round the trap.
          if (!popup.contains(element) || footer.contains(element)) {
            return { name: "", overflow: 0 };
          }
          const box = element.getBoundingClientRect();
          const popupBox = popup.getBoundingClientRect();
          return {
            name:
              element.getAttribute("aria-label") ??
              element.closest("label")?.textContent ??
              (element.id
                ? document.querySelector(`label[for="${element.id}"]`)
                    ?.textContent
                : undefined) ??
              element.textContent ??
              element.tagName,
            overflow: Math.max(
              box.bottom -
                Math.min(footer.getBoundingClientRect().top, popupBox.bottom),
              popupBox.top - box.top
            ),
          };
        });
        if (!focused) {
          return { outOfView, visited };
        }
        return tabThrough(
          visited + 1,
          focused.overflow > 0
            ? [
                ...outOfView,
                `${focused.name}: ${Math.ceil(focused.overflow)}px`,
              ]
            : outOfView
        );
      };
      const { outOfView, visited } = await tabThrough(0, []);

      // The operations, the credit's fields, the episode checklist, and
      // Cancel.
      expect(visited).toBeGreaterThan(5);
      expect(outOfView).toEqual([]);
    });
  }

  test("scrolls to its footer on a viewport too short for it", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 256, width: 320 });
    const apply = await openCreditsDialog(page);

    await apply.scrollIntoViewIfNeeded();
    await expect(apply).toBeInViewport({ ratio: 1 });
  });
});
