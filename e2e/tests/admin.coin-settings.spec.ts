import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { reorderWithKeyboard, signInAsAdmin } from "../src/admin";
import { setTenantCoinsAllowed, takePaymentsThroughStripe } from "../src/coins";
import { applyScenarioSql } from "../src/db";
import {
  ADMIN_COIN_SETTINGS_ADMIN,
  ADMIN_COIN_SETTINGS_AUDITOR,
  ADMIN_COIN_SETTINGS_EDITOR,
  ADMIN_COIN_SETTINGS_HOLDER_SCENARIO,
  ADMIN_COIN_SETTINGS_READER,
  ADMIN_COIN_SETTINGS_SCENARIO,
} from "../src/scenarios/admin-coin-settings";
import { PLATFORM_TENANT_COINS_SCENARIO } from "../src/scenarios/platform-tenant-coins";
import { serverActionAnswered } from "../src/server-action";
import { signInAsMember } from "../src/storefront";
import {
  WEB_ADMIN_COIN_SETTINGS_BASE_URL,
  WEB_STOREFRONT_COIN_SETTINGS_BASE_URL,
} from "../src/urls";

/**
 * A tenant administrator taking a tenant that has saved nothing about coins
 * to coins on sale under a name of its own — Stars in English, スター in
 * Japanese — then stopping the sales, and being refused turning coins off
 * while a reader still holds some. The site is read back at each step, and an
 * editor and an auditor are not offered the screen at all.
 */

const COIN_NAME = "Stars";

const adminUrl = (path: string) =>
  new URL(path, WEB_ADMIN_COIN_SETTINGS_BASE_URL).toString();

const storefrontUrl = (path: string) =>
  new URL(path, WEB_STOREFRONT_COIN_SETTINGS_BASE_URL).toString();

const saveSettings = (page: Page) =>
  page.getByRole("button", { name: "Save coin settings" });

const status = (page: Page, name: string) =>
  page.getByText(name, { exact: true });

/**
 * Opens the reader's coins page until `check` passes. The API reads the
 * platform's allowance through a cache of its own for a few seconds after it
 * changes, so the first reads after the console's save can still answer with
 * what was there before.
 */
const expectOnCoinsPage = async (
  page: Page,
  check: (page: Page) => Promise<void>
): Promise<void> => {
  await expect(async () => {
    await page.goto(storefrontUrl("/my/coins"));
    await check(page);
  }).toPass({ timeout: 60_000 });
};

test.describe.configure({ mode: "serial" });

test.describe("web-admin coin settings", () => {
  test.beforeAll(async ({ browser }) => {
    applyScenarioSql(ADMIN_COIN_SETTINGS_SCENARIO);
    applyScenarioSql(PLATFORM_TENANT_COINS_SCENARIO);

    const page = await browser.newPage();
    try {
      await setTenantCoinsAllowed(page, true);
      await takePaymentsThroughStripe(
        page,
        ADMIN_COIN_SETTINGS_ADMIN,
        WEB_ADMIN_COIN_SETTINGS_BASE_URL
      );
    } finally {
      await page.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    // Switches the platform's allowance off again, the value every other
    // suite expects, and puts the tenant back as it was.
    const page = await browser.newPage();
    try {
      await setTenantCoinsAllowed(page, false);
    } finally {
      await page.close();
    }
    applyScenarioSql(ADMIN_COIN_SETTINGS_SCENARIO);
  });

  test("an administrator names the coin, fills in the disclosures, adds packs, and turns coins on", async ({
    browser,
    page,
  }) => {
    await signInAsAdmin(
      page,
      ADMIN_COIN_SETTINGS_ADMIN,
      "/coins",
      WEB_ADMIN_COIN_SETTINGS_BASE_URL
    );
    await page.goto(adminUrl("/coins"));
    await expect(
      page.getByRole("navigation").getByRole("link", { name: "Coins" })
    ).toBeVisible();
    await expect(status(page, "Off")).toBeVisible();

    // Nothing saved yet: the name readers fall back to is required first.
    await saveSettings(page).click();
    await expect(page.getByText("Enter the name in English.")).toBeVisible();

    await page.getByRole("textbox", { name: "English" }).fill(COIN_NAME);
    await page.getByRole("textbox", { name: "日本語" }).fill("スター");
    await page.getByLabel("Value of one coin").fill("10");
    await page.getByLabel("Days until expiry").fill("90");
    await page.getByLabel("Issuer name").fill("Lantern Press Ltd.");
    await page.getByLabel("Terms URL").fill("https://example.com/stars-terms");
    await page.getByLabel("Contact").fill("stars@example.com");
    await page
      .getByLabel("Notice")
      .fill("Unused Stars are refunded only where the law requires it.");
    await saveSettings(page).click();
    await expect(page.getByText("The coin settings were saved.")).toBeVisible();

    // The saved name is what the pack fields now speak of.
    const addPack = page.getByRole("button", { name: "Add pack" });
    await page
      .getByLabel(/^Stars per pack/u)
      .last()
      .fill("100");
    await page.getByLabel("Bonus Stars").last().fill("10");
    await page
      .getByLabel(/^Price \(JPY\)/u)
      .last()
      .fill("1000");
    await addPack.click();
    await expect(page.getByText("The pack was added.")).toBeVisible();
    await page
      .getByLabel(/^Stars per pack/u)
      .last()
      .fill("50");
    await page
      .getByLabel(/^Price \(JPY\)/u)
      .last()
      .fill("500");
    await addPack.click();
    await expect(page.getByText("50 Stars", { exact: true })).toBeVisible();

    // The smaller pack goes first; the reload reads the order back from the
    // API rather than from the list the keyboard rearranged.
    const reordered = serverActionAnswered(page);
    await reorderWithKeyboard(page, "Reorder 50 Stars", "ArrowUp");
    await reordered;
    await page.reload();
    await expect(
      page.getByRole("list", { name: "Packs" }).getByRole("listitem").first()
    ).toContainText("50 Stars");

    await page.getByRole("checkbox", { name: "Enable coins" }).check();
    await page.getByRole("checkbox", { name: "Sell packs" }).check();
    await saveSettings(page).click();
    await expect(page.getByText("The coin settings were saved.")).toBeVisible();
    await expect(status(page, "On, selling")).toBeVisible();

    const reader = await browser.newPage();
    try {
      await signInAsMember(
        reader,
        ADMIN_COIN_SETTINGS_READER,
        "/my/coins",
        WEB_STOREFRONT_COIN_SETTINGS_BASE_URL
      );
      await expectOnCoinsPage(reader, async (coinsPage) => {
        await expect(
          coinsPage.getByRole("heading", { level: 1, name: COIN_NAME })
        ).toBeVisible({ timeout: 2000 });
      });
      const packs = reader.getByRole("region", { name: "Buy Stars" });
      await expect(
        packs.getByRole("heading", { exact: true, name: "50 Stars" })
      ).toBeVisible();
      await expect(reader.getByText("Lantern Press Ltd.")).toBeVisible();
    } finally {
      await reader.close();
    }
  });

  test("stopping the sales takes the packs off the site and leaves coins on", async ({
    browser,
    page,
  }) => {
    await signInAsAdmin(
      page,
      ADMIN_COIN_SETTINGS_ADMIN,
      "/coins",
      WEB_ADMIN_COIN_SETTINGS_BASE_URL
    );
    await page.goto(adminUrl("/coins"));
    await page.getByRole("checkbox", { name: "Sell packs" }).uncheck();
    await saveSettings(page).click();
    await expect(page.getByText("The coin settings were saved.")).toBeVisible();
    await expect(status(page, "On, not selling")).toBeVisible();

    const reader = await browser.newPage();
    try {
      await signInAsMember(
        reader,
        ADMIN_COIN_SETTINGS_READER,
        "/my/coins",
        WEB_STOREFRONT_COIN_SETTINGS_BASE_URL
      );
      await expectOnCoinsPage(reader, async (coinsPage) => {
        await expect(
          coinsPage.getByText(
            "Stars are not on sale at the moment. You can keep spending the ones you hold."
          )
        ).toBeVisible({ timeout: 2000 });
      });
      await expect(reader.getByRole("button", { name: /^Buy/u })).toHaveCount(
        0
      );
    } finally {
      await reader.close();
    }
  });

  test("turning coins off is refused while a reader holds some, naming how many", async ({
    page,
  }) => {
    applyScenarioSql(ADMIN_COIN_SETTINGS_HOLDER_SCENARIO);

    await signInAsAdmin(
      page,
      ADMIN_COIN_SETTINGS_ADMIN,
      "/coins",
      WEB_ADMIN_COIN_SETTINGS_BASE_URL
    );
    await page.goto(adminUrl("/coins"));
    await page.getByRole("checkbox", { name: "Enable coins" }).uncheck();
    await saveSettings(page).click();

    await expect(
      page.getByText(
        "1 reader still holds Stars that have not expired, so coins cannot be turned off. Clear Sell packs and save instead, and turn coins off once those Stars have expired."
      )
    ).toBeVisible();
    await page.reload();
    await expect(status(page, "On, not selling")).toBeVisible();
  });

  for (const [role, credentials] of [
    ["an editor", ADMIN_COIN_SETTINGS_EDITOR],
    ["an auditor", ADMIN_COIN_SETTINGS_AUDITOR],
  ] as const) {
    test(`${role} is not offered the screen or its save controls`, async ({
      page,
    }) => {
      await signInAsAdmin(
        page,
        credentials,
        "/",
        WEB_ADMIN_COIN_SETTINGS_BASE_URL
      );
      await page.goto(adminUrl("/coins"));

      await expect(
        page.getByRole("heading", { name: "Page not found" })
      ).toBeVisible();
      await expect(saveSettings(page)).toHaveCount(0);
      await expect(
        page.getByRole("navigation").getByRole("link", { name: "Coins" })
      ).toHaveCount(0);
    });
  }
});
