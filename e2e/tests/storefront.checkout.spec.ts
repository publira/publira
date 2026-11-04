import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { seriesFormFields, signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import { uploadEpisodePages } from "../src/episode-pages";
import {
  EPISODE_RENTALS_ADMIN,
  EPISODE_RENTALS_AUTHOR,
  EPISODE_RENTALS_CAMPAIGN,
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
 * copy, a third buys an episode at the campaign price open on it, a fourth
 * buys a volume from the series page and a fifth every episode of the series
 * at the discount the admin sets on the series form. Each pays on the
 * checkout page, returns to the page the sale was started from with what the
 * webhook opened, and finds the sale in the library.
 *
 * Last, the admin issues a promotion code from the console: a sixth reader
 * applies it at episode 1's gate, pays the discounted price on a checkout page
 * that offers no code of its own, and finds what they paid in the library,
 * while the open month's royalties credit the sale at the price before the
 * code; a seventh enters a code the tenant does not hold and is told so.
 */

/**
 * Takes the tenant's payments through Stripe, which is what lets the gate
 * sell. The webhook URL the console shows is registered with the stand-in
 * under the secret key entered, as an operator registers it in Stripe's
 * dashboard, and the signing secret that answers is stored beside the key.
 *
 * The key is a new one each run, an account of its own: the stand-in answers
 * a checkout the server starts again for the same reader with the session
 * paid under the same key, as Stripe answers a repeated idempotency key, and
 * a run that starts over has deleted the sale that session made. It is a
 * live-mode key, so the purchases are sales the royalties count rather than
 * test purchases.
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
  await secretKey.fill(`sk_live_${randomUUID().replaceAll("-", "")}`);

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

/** How every page writes the end of the campaign on episode 4. */
const CAMPAIGN_UNTIL = "Sale until Sun, Mar 30, 3:00 PM";

/** The row that links to `title` in the list or panel `scope` holds. */
const episodeRow = (page: Page, title: string) =>
  page.getByRole("listitem").filter({ hasText: title });

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

/** The gate's code field, opened from its disclosure. */
const applyCode = async (page: Page, typed: string) => {
  await page.locator("summary").filter({ hasText: "Promotion code" }).click();
  await page.getByRole("textbox", { name: "Promotion code" }).fill(typed);
  await page.getByRole("button", { exact: true, name: "Apply" }).click();
};

/**
 * The current month's sales on the royalties screen, which every credited sale
 * adds its basis to. The screen opens on the oldest month still open, so the
 * month a sale made now falls in, in the tenant's UTC, is named.
 */
const openMonthSales = async (admin: Page): Promise<number> => {
  const period = Temporal.Now.plainDateISO("UTC").toPlainYearMonth().toString();

  await admin.goto(`${WEB_ADMIN_RENTALS_BASE_URL}/royalties?period=${period}`);

  const sales = admin
    .locator("dt")
    .filter({ hasText: /^Sales$/u })
    .locator("xpath=following-sibling::dd[1]");

  await expect(sales).toBeVisible();

  const text = await sales.textContent();

  return Number((text ?? "").replaceAll(/\D/gu, ""));
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
    // The tenant holds no promotion code yet, so the gate offers no field.
    await expect(
      page.getByRole("textbox", { name: "Promotion code" })
    ).toHaveCount(0);
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

  test("a reader sees an episode's campaign price and its end, buys it at that price, and finds what they paid in the library", async ({
    page,
  }) => {
    const { episode } = EPISODE_RENTALS_CAMPAIGN;
    const [, third] = EPISODE_RENTALS_LATER_EPISODES;
    await signInAsMember(
      page,
      EPISODE_RENTALS_READERS.campaignBuyer,
      episodeRentalsSeriesPath,
      WEB_STOREFRONT_RENTALS_BASE_URL
    );

    // The series lists the campaign price beside the regular one, and the
    // episode without a campaign at its own price, as before.
    const campaignRow = episodeRow(page, episode.title);
    await expect(campaignRow.getByText("¥150", { exact: true })).toBeVisible();
    await expect(campaignRow.getByText("Regular price ¥200")).toBeAttached();
    await expect(campaignRow.getByText(CAMPAIGN_UNTIL)).toBeVisible();
    const regularRow = episodeRow(page, third.title);
    await expect(regularRow.getByText("¥200", { exact: true })).toBeVisible();
    await expect(regularRow.getByText(/^Sale until/u)).toHaveCount(0);

    // So does the link to it from the episode before it.
    await page.goto(
      `${WEB_STOREFRONT_RENTALS_BASE_URL}${episodeRentalsSeriesPath}/episodes/${third.publicId}`
    );
    await expect(
      episodeRow(page, episode.title).getByText(CAMPAIGN_UNTIL)
    ).toBeVisible();

    const path = `${episodeRentalsSeriesPath}/episodes/${episode.publicId}`;
    await page.goto(`${WEB_STOREFRONT_RENTALS_BASE_URL}${path}`);
    await expect(page.getByText("You cannot read this episode")).toBeVisible();
    await expect(page.getByText(CAMPAIGN_UNTIL).first()).toBeVisible();
    await page.getByRole("button", { name: "Buy for ¥150" }).click();

    await pay(page, episode.title, "¥150", path);
    await expectEpisodeOpen(page, episode.title);
    await expect(
      page.getByText(
        "You pay the price the payment page showed. If a campaign had ended by the time you started the purchase, that is the regular price."
      )
    ).toBeVisible();
    await page.getByRole("link", { name: "See what you paid" }).click();

    await page.waitForURL("**/my/library");
    const card = await libraryCard(page);
    await expect(card.getByText("¥150")).toBeVisible();
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
    // holds: 300 yen for the first and the 150 episode 4 sells for under its
    // campaign, less 10%.
    await expect(
      page.getByRole("button", { name: "Buy remaining episodes (2) for ¥405" })
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

  test("a reader buys every remaining episode at the discount the admin set, and each one opens", async ({
    browser,
    page,
  }) => {
    const admin = await browser.newPage();

    try {
      await signInAsAdmin(
        admin,
        EPISODE_RENTALS_ADMIN,
        episodeRentalsSeriesPath,
        WEB_ADMIN_RENTALS_BASE_URL
      );
      const { bundleDiscountPercent } = seriesFormFields(admin);
      await expect(bundleDiscountPercent).toHaveValue("10");
      await bundleDiscountPercent.fill("25");
      await admin.getByRole("button", { name: "Update series" }).click();
      await expect(admin.getByText("Series updated.")).toBeVisible({
        timeout: 30_000,
      });
      await expect(bundleDiscountPercent).toHaveValue("25");
    } finally {
      await admin.close();
    }

    await signInAsMember(
      page,
      EPISODE_RENTALS_READERS.remainderBuyer,
      episodeRentalsSeriesPath,
      WEB_STOREFRONT_RENTALS_BASE_URL
    );

    // 300 yen for the first episode, 200 for the next two, and 150 for the
    // fourth under its campaign, less 25% and rounded down.
    await expect(
      page.getByText("25% off the ¥850 they cost one by one")
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Buy remaining episodes (4) for ¥637" })
      .click();

    await pay(page, "4 items", "¥637", episodeRentalsSeriesPath);
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

  test.describe("with a promotion code", () => {
    /** A new spelling each run, which a retry can create again. */
    const code = `HALF${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;

    test.beforeAll(async ({ browser }) => {
      const admin = await browser.newPage();

      try {
        await signInAsAdmin(
          admin,
          EPISODE_RENTALS_ADMIN,
          "/promotion-codes/new",
          WEB_ADMIN_RENTALS_BASE_URL
        );
        await admin.getByRole("textbox", { name: /^Code/u }).fill(code);
        await admin.getByRole("spinbutton", { name: /Percentage/u }).fill("50");
        await admin
          .getByRole("radio", { exact: true, name: "Whole catalog" })
          .click();
        await admin
          .getByRole("button", { exact: true, name: "Create promotion code" })
          .click();
        await expect(admin).toHaveURL(/\/promotion-codes\?code=[0-9a-f-]{36}/u);
      } finally {
        await admin.close();
      }
    });

    test("a reader applies the admin's code at the gate, pays the discounted price, and the royalties credit the price before it", async ({
      browser,
      page,
    }) => {
      const admin = await browser.newPage();

      try {
        await signInAsAdmin(
          admin,
          EPISODE_RENTALS_ADMIN,
          "/royalties",
          WEB_ADMIN_RENTALS_BASE_URL
        );
        const salesBefore = await openMonthSales(admin);

        await signInAsMember(
          page,
          EPISODE_RENTALS_READERS.codeBuyer,
          episodeRentalPath,
          WEB_STOREFRONT_RENTALS_BASE_URL
        );
        await expect(
          page.getByRole("button", { name: "Buy for ¥300" })
        ).toBeVisible();

        // Typed in lower case, which the code is matched without regard to.
        await applyCode(page, code.toLowerCase());
        await expect(
          page.getByText(`Code ${code.toLowerCase()} applied.`)
        ).toBeVisible();
        const buy = page.getByRole("button", { name: /^Buy for ¥150/u });
        await expect(buy).toBeVisible();
        await expect(buy.locator("s")).toHaveText("Price before the code ¥300");
        await expect(
          page.getByRole("button", { name: /^Rent for 48 hours \(¥50\)/u })
        ).toBeVisible();

        // The code is kept in the URL, so a reload quotes it again.
        await expect(page).toHaveURL(/[?&]promotion_code=/u);
        await page.reload();
        await expect(buy).toBeVisible();

        await buy.click();
        await page.waitForURL(`${STRIPE_BASE_URL}/checkout/**`);
        // The checkout already carries the code's discount, so the payment
        // page offers no code input of its own.
        await expect(page.getByLabel("Add promotion code")).toHaveCount(0);
        await payAndReturn(page, EPISODE_RENTALS_EPISODE.title, "¥150");
        await expect(page.getByText("Amount paid")).toBeVisible();
        await expect(
          page.getByText(`Code ${code}`, { exact: true })
        ).toBeVisible();

        const card = await libraryCard(page);
        await expect(card.getByText("¥150", { exact: true })).toBeVisible();
        await expect(card.locator("s")).toHaveText(
          "Price before the code ¥300"
        );
        await expect(
          card.getByText(`Code ${code}`, { exact: true })
        ).toBeVisible();

        // The Author is paid on the 300 yen the episode sells for, not the
        // 150 the reader paid.
        await expect(async () => {
          expect(await openMonthSales(admin)).toBe(salesBefore + 300);
        }).toPass({ timeout: 30_000 });
        await expect(
          admin.getByRole("rowheader", { name: EPISODE_RENTALS_AUTHOR.name })
        ).toBeVisible();
      } finally {
        await admin.close();
      }
    });

    test("a reader who enters a code the tenant does not hold is told so, and the prices stay", async ({
      page,
    }) => {
      await signInAsMember(
        page,
        EPISODE_RENTALS_READERS.codeMistyper,
        episodeRentalPath,
        WEB_STOREFRONT_RENTALS_BASE_URL
      );

      await applyCode(page, "NOSUCHCODE");
      await expect(page.getByText("This code isn't valid.")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Buy for ¥300" })
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Rent for 48 hours (¥100)" })
      ).toBeVisible();
      await expect(page).not.toHaveURL(/[?&]promotion_code=/u);
    });
  });
});
