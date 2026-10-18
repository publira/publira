import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import { uploadEpisodePages } from "../src/episode-pages";
import {
  EPISODE_RENTALS_ADMIN,
  EPISODE_RENTALS_EPISODE,
  EPISODE_RENTALS_READERS,
  EPISODE_RENTALS_SCENARIO,
  EPISODE_RENTALS_SERIES,
  episodeRentalPath,
} from "../src/scenarios/episode-rentals";
import { episodePageLabel } from "../src/scenarios/viewer-pages";
import { signInAsMember } from "../src/storefront";
import {
  WEB_ADMIN_RENTALS_BASE_URL,
  WEB_STOREFRONT_RENTALS_BASE_URL,
} from "../src/urls";

/**
 * An episode sold two ways: the gate offers a reader the permanent copy and
 * the rental, each at its price, and a reader who rented it reads it and finds
 * in the library that it is a rental and how long it has left.
 *
 * Neither sale is submitted: a checkout is a request to Stripe, which the stack
 * has no stand-in for yet (#4507). Which kind the gate sends is covered by the
 * Action's and the gate's own tests.
 */

/** Takes the tenant's payments through Stripe, which is what lets the gate sell. */
const takePaymentsThroughStripe = async (page: Page) => {
  await signInAsAdmin(
    page,
    EPISODE_RENTALS_ADMIN,
    "/integrations/payment",
    WEB_ADMIN_RENTALS_BASE_URL
  );
  const provider = page.getByRole("combobox", { name: "Payment provider" });
  await provider.click();
  await page.getByRole("option", { name: "Stripe" }).click();
  await expect(provider).toContainText("Stripe");

  await page.getByRole("checkbox", { name: "Enable payments" }).click();
  await page.getByLabel(/^Secret key/u).fill("sk_test_placeholder");
  await page.getByLabel(/^Webhook signing secret/u).fill("whsec_placeholder");
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(
    page.getByText("The payment settings were saved.")
  ).toBeVisible();
};

test.describe.configure({ mode: "serial" });

test.describe("web-storefront episode rentals", () => {
  test.beforeAll(async ({ browser }) => {
    applyScenarioSql(EPISODE_RENTALS_SCENARIO);
    // The pages are what proves the rental opened the episode.
    uploadEpisodePages(EPISODE_RENTALS_EPISODE.publicId);

    const page = await browser.newPage();
    try {
      await takePaymentsThroughStripe(page);
    } finally {
      await page.close();
    }
  });

  test.afterAll(() => {
    applyScenarioSql(EPISODE_RENTALS_SCENARIO);
  });

  test("the gate offers a reader who holds neither sale both, each at its price", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      EPISODE_RENTALS_READERS.chooser,
      episodeRentalPath,
      WEB_STOREFRONT_RENTALS_BASE_URL
    );

    await expect(page.getByText("You cannot read this episode")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Buy for ¥300" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Rent for 48 hours (¥100)" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Buy this episode" })
    ).toHaveCount(0);
  });

  test("a reader who rented the episode reads it and sees the time left in the library", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      EPISODE_RENTALS_READERS.holder,
      episodeRentalPath,
      WEB_STOREFRONT_RENTALS_BASE_URL
    );

    await expect(
      page.locator(
        `canvas[aria-label="${episodePageLabel(EPISODE_RENTALS_EPISODE.title, 1)}"]`
      )
    ).toBeVisible();
    await expect(page.getByText("You cannot read this episode")).toHaveCount(0);

    await page.goto(`${WEB_STOREFRONT_RENTALS_BASE_URL}/my/library`);

    const card = page
      .getByRole("article")
      .filter({ hasText: EPISODE_RENTALS_SERIES.title });
    await expect(card.getByText("Readable")).toBeVisible();
    await expect(
      card.getByRole("term").filter({ hasText: "Type" })
    ).toBeVisible();
    await expect(
      card.getByRole("definition").filter({ hasText: "Rental" })
    ).toBeVisible();
    await expect(
      card.getByText(/^(?:46 hr \d+ min|47 hr) left$/u)
    ).toBeVisible();
  });
});
