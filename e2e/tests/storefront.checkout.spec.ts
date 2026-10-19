import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import { uploadEpisodePages } from "../src/episode-pages";
import {
  EPISODE_RENTALS_ADMIN,
  EPISODE_RENTALS_EPISODE,
  EPISODE_RENTALS_LATER_EPISODES,
  EPISODE_RENTALS_READERS,
  EPISODE_RENTALS_SCENARIO,
  EPISODE_RENTALS_SERIES,
  EPISODE_RENTALS_VOLUME,
  episodeRentalPath,
  episodeRentalsSeriesPath,
} from "../src/scenarios/episode-rentals";
import { episodePageLabel } from "../src/scenarios/viewer-pages";
import { signInAsMember } from "../src/storefront";
import { registerStripeWebhook } from "../src/stripe";
import {
  STRIPE_BASE_URL,
  WEB_ADMIN_RENTALS_BASE_URL,
  WEB_STOREFRONT_RENTALS_BASE_URL,
} from "../src/urls";

/**
 * Readers buying through Stripe Checkout, against the stack's stand-in for
 * Stripe: one rents an episode at its gate and another buys its permanent
 * copy, a third buys a volume from the series page and a fourth every episode
 * of the series at its discount. Each pays on the checkout page, returns to
 * the page the sale was started from with what the webhook opened, and finds
 * the sale in the library.
 */

/**
 * Takes the tenant's payments through Stripe, which is what lets the gate
 * sell. The webhook URL the console shows is registered with the stand-in
 * under the secret key entered, as an operator registers it in Stripe's
 * dashboard, and the signing secret that answers is stored beside the key.
 *
 * The key is a new one each run, a test account of its own: the stand-in
 * answers a checkout the server starts again for the same reader with the
 * session paid under the same key, as Stripe answers a repeated idempotency
 * key, and a run that starts over has deleted the sale that session made.
 */
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
  const secretKey = page.getByLabel(/^Secret key/u);
  await secretKey.fill(`sk_test_${randomUUID().replaceAll("-", "")}`);
  const webhookSecret = await registerStripeWebhook(
    await secretKey.inputValue(),
    await page.getByLabel("Webhook URL").inputValue()
  );
  await page.getByLabel(/^Webhook signing secret/u).fill(webhookSecret);
  await page.getByRole("button", { exact: true, name: "Save" }).click();
  await expect(
    page.getByText("The payment settings were saved.")
  ).toBeVisible();
};

/**
 * Pay on the stand-in's checkout page, which is headed by what was sold and
 * shows the total, and come back to the storefront page `path` names.
 */
const pay = async (
  page: Page,
  heading: string,
  amount: string,
  path: string
) => {
  await page.waitForURL(`${STRIPE_BASE_URL}/checkout/**`);
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await expect(page.getByText(amount, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Pay" }).click();

  await page.waitForURL(
    (url) =>
      url.origin === new URL(WEB_STOREFRONT_RENTALS_BASE_URL).origin &&
      url.pathname.endsWith(path) &&
      url.searchParams.get("checkout") === "success"
  );
};

/** The episode's first page drawn, which only a reader it is open to sees. */
const expectEpisodeOpen = async (page: Page, title: string) => {
  await expect(
    page.locator(`canvas[aria-label="${episodePageLabel(title, 1)}"]`)
  ).toBeVisible();
  await expect(page.getByText("You cannot read this episode")).toHaveCount(0);
};

/** Open one of the series' episodes and find it readable. */
const openEpisode = async (
  page: Page,
  episode: { publicId: string; title: string }
) => {
  await page.goto(
    `${WEB_STOREFRONT_RENTALS_BASE_URL}${episodeRentalsSeriesPath}/episodes/${episode.publicId}`
  );
  await expectEpisodeOpen(page, episode.title);
};

/**
 * Pay on the stand-in's checkout page, which names what the gate sold, and
 * come back to the episode with its body drawn.
 */
const payAndReturn = async (page: Page, lineItem: string, amount: string) => {
  await pay(page, lineItem, amount, episodeRentalPath);
  await expectEpisodeOpen(page, EPISODE_RENTALS_EPISODE.title);
};

/** The volume's card on the series page. */
const volumeCard = (page: Page) =>
  page.getByRole("article").filter({
    has: page.getByRole("heading", { name: EPISODE_RENTALS_VOLUME.title }),
  });

/** What the series page says to a reader the provider has just sent back. */
const PAYMENT_CONFIRMING =
  "We are confirming your payment. The episodes open once the purchase is applied.";

/** The reader's library card for the episode, which the sale made readable. */
const libraryCard = async (page: Page) => {
  await page.goto(`${WEB_STOREFRONT_RENTALS_BASE_URL}/my/library`);
  const card = page
    .getByRole("article")
    .filter({ hasText: EPISODE_RENTALS_SERIES.title });
  await expect(card.getByText("Readable")).toBeVisible();
  await expect(
    card.getByRole("term").filter({ hasText: "Type" })
  ).toBeVisible();
  return card;
};

test.describe.configure({ mode: "serial" });

test.describe("web-storefront checkout", () => {
  test.beforeAll(async ({ browser }) => {
    applyScenarioSql(EPISODE_RENTALS_SCENARIO);
    // The pages are what proves the checkout opened an episode.
    for (const { publicId } of [
      EPISODE_RENTALS_EPISODE,
      ...EPISODE_RENTALS_LATER_EPISODES,
    ]) {
      uploadEpisodePages(publicId);
    }

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

  test("a reader rents the episode at the gate, reads it, and sees the time left in the library", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      EPISODE_RENTALS_READERS.renter,
      episodeRentalPath,
      WEB_STOREFRONT_RENTALS_BASE_URL
    );

    await expect(page.getByText("You cannot read this episode")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Buy for ¥300" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Buy this episode" })
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Rent for 48 hours (¥100)" })
      .click();

    await payAndReturn(
      page,
      `${EPISODE_RENTALS_EPISODE.title} (rental, 48 hours)`,
      "¥100"
    );

    const card = await libraryCard(page);
    await expect(
      card.getByRole("definition").filter({ hasText: "Rental" })
    ).toBeVisible();
    await expect(
      card.getByText(/^(?:47 hr \d+ min|48 hr) left$/u)
    ).toBeVisible();
  });

  test("a reader buys the permanent copy at the gate, reads it, and finds it in the library", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      EPISODE_RENTALS_READERS.buyer,
      episodeRentalPath,
      WEB_STOREFRONT_RENTALS_BASE_URL
    );

    await page.getByRole("button", { name: "Buy for ¥300" }).click();

    await payAndReturn(page, EPISODE_RENTALS_EPISODE.title, "¥300");

    const card = await libraryCard(page);
    await expect(
      card.getByRole("definition").filter({ hasText: "Purchase" })
    ).toBeVisible();
    await expect(card.getByText("No expiry")).toBeVisible();
  });

  test("a reader buys a volume from the series page, and every episode in it opens", async ({
    page,
  }) => {
    const [second, third, fourth] = EPISODE_RENTALS_LATER_EPISODES;
    await signInAsMember(
      page,
      EPISODE_RENTALS_READERS.volumeBuyer,
      episodeRentalsSeriesPath,
      WEB_STOREFRONT_RENTALS_BASE_URL
    );

    const volume = volumeCard(page);
    await expect(volume.getByText("2 episodes")).toBeVisible();
    await expect(volume.getByText("¥350")).toBeVisible();
    await volume.getByRole("button", { name: "Buy volume" }).click();

    await pay(
      page,
      EPISODE_RENTALS_VOLUME.title,
      "¥350",
      episodeRentalsSeriesPath
    );
    await expect(page.getByText(PAYMENT_CONFIRMING)).toBeVisible();
    await expect(
      volume.getByText("You own every episode in this volume")
    ).toBeVisible();
    await expect(
      volume.getByRole("button", { name: "Buy volume" })
    ).toHaveCount(0);
    // The rest of the series no longer counts the two episodes the volume
    // holds: 300 and 200 yen, less 10%.
    await expect(
      page.getByRole("button", { name: "Buy remaining episodes (2) for ¥450" })
    ).toBeVisible();

    await openEpisode(page, second);
    await openEpisode(page, third);
    await page.goto(
      `${WEB_STOREFRONT_RENTALS_BASE_URL}${episodeRentalsSeriesPath}/episodes/${fourth.publicId}`
    );
    await expect(page.getByText("You cannot read this episode")).toBeVisible();

    const card = await libraryCard(page);
    await expect(
      card.getByRole("link", { name: EPISODE_RENTALS_VOLUME.title })
    ).toBeVisible();
    await expect(card.getByRole("link", { name: "Open series" })).toBeVisible();
  });

  test("a reader buys every remaining episode at the series' discount, and each one opens", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      EPISODE_RENTALS_READERS.remainderBuyer,
      episodeRentalsSeriesPath,
      WEB_STOREFRONT_RENTALS_BASE_URL
    );

    // 300 yen for the first episode and 200 for each of the other three,
    // less 10%.
    await expect(
      page.getByText("10% off the ¥900 they cost one by one")
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Buy remaining episodes (4) for ¥810" })
      .click();

    await pay(page, "4 items", "¥810", episodeRentalsSeriesPath);
    await expect(page.getByText(PAYMENT_CONFIRMING)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Buy remaining episodes/u })
    ).toHaveCount(0);
    await expect(
      volumeCard(page).getByText("You own every episode in this volume")
    ).toBeVisible();

    const [second, third, fourth] = EPISODE_RENTALS_LATER_EPISODES;
    await openEpisode(page, EPISODE_RENTALS_EPISODE);
    await openEpisode(page, second);
    await openEpisode(page, third);
    await openEpisode(page, fourth);

    const card = await libraryCard(page);
    await expect(
      card.getByRole("link", { name: "Remaining episodes (4)" })
    ).toBeVisible();
  });
});
