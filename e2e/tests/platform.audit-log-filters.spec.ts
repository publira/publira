import { readFileSync } from "node:fs";

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsSeedPlatformSuperAdmin } from "../src/platform";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

/** Every locale the console ships, as `locales/index.json` registers them. */
const LOCALES: readonly string[] = (
  JSON.parse(
    readFileSync(new URL("../../locales/index.json", import.meta.url), "utf-8")
  ) as { locales: { code: string }[] }
).locales.map(({ code }) => code);

/** A phone, the narrowest tablet held upright, and the desktop the suite runs at. */
const WIDTHS = [390, 744, 1280];

/**
 * Open the action filter until `option` shows. The trigger is pressed again
 * only while the list is still closed, since the first click can land before
 * the filter has hydrated.
 */
const openActions = async (
  trigger: Locator,
  option: Locator
): Promise<void> => {
  await expect(async () => {
    if (!(await option.isVisible())) {
      await trigger.click();
    }
    await expect(option).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
};

/**
 * How far the name in the trigger runs into its padding on each side, and
 * past the right edge of the screen: zero or less everywhere when it fits.
 */
const overflow = (trigger: Locator) =>
  trigger.evaluate((element) => {
    const value = element.firstElementChild;
    if (!value) {
      throw new TypeError("The action filter shows no value.");
    }
    const styles = element.computedStyleMap();
    const inset = (side: "bottom" | "left" | "right" | "top"): number => {
      const border = styles.get(`border-${side}-width`);
      const padding = styles.get(`padding-${side}`);
      return (
        (border instanceof CSSUnitValue ? border.value : 0) +
        (padding instanceof CSSUnitValue ? padding.value : 0)
      );
    };
    const box = element.getBoundingClientRect();
    const text = value.getBoundingClientRect();
    return Math.max(
      text.bottom - (box.bottom - inset("bottom")),
      box.left + inset("left") - text.left,
      text.right - (box.right - inset("right")),
      box.top + inset("top") - text.top,
      box.right - document.documentElement.clientWidth
    );
  });

/**
 * Choose each action from `index` on in turn and check its name fits.
 *
 * Recursion rather than a loop: every step drives the one select, so the
 * choices cannot be made together.
 */
const expectEachActionFits = async (
  page: Page,
  trigger: Locator,
  index: number,
  count: number
): Promise<void> => {
  if (index >= count) {
    return;
  }

  const option = page.getByRole("option").nth(index);
  await openActions(trigger, option);
  const text = await option.textContent();
  const label = text?.trim() ?? "";
  await option.click();
  await expect(option).toBeHidden();
  await expect(trigger).toHaveText(label);

  expect(await overflow(trigger), label).toBeLessThanOrEqual(0.5);

  await expectEachActionFits(page, trigger, index + 1, count);
};

/**
 * The action filter of the audit log names an action in a phrase that runs
 * from two words to a sentence, so every name it offers is chosen in turn,
 * in every locale and at every width the console is laid out for, to see that
 * none of them spills out of the trigger.
 */
test.describe("web-platform audit log action filter", () => {
  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      test(`fits every action name in ${locale} at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ height: 900, width });
        await signInAsSeedPlatformSuperAdmin(page, "/audit-logs");
        await page.context().addCookies([
          {
            name: "publira_locale",
            url: WEB_PLATFORM_BASE_URL,
            value: locale,
          },
        ]);
        await page.goto(`${WEB_PLATFORM_BASE_URL}/audit-logs`);

        const trigger = page.getByRole("main").getByRole("combobox");
        await openActions(trigger, page.getByRole("option").first());
        const count = await page.getByRole("option").count();
        await page.keyboard.press("Escape");
        // An option stays visible while the list fades out, and would pass for
        // an open list in the first step below.
        await expect(page.getByRole("option").first()).toBeHidden();

        await expectEachActionFits(page, trigger, 0, count);
      });
    }
  }
});
