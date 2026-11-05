import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { takePaymentsThroughStripe } from "../src/coins";
import { applyScenarioSql } from "../src/db";
import {
  DOCS_LOCALES,
  docsSection,
  docsText,
  expectDocsScreenshot,
} from "../src/docs-screenshots";
import { uploadEpisodePages } from "../src/episode-pages";
import {
  EPISODE_RENTALS_ADMIN,
  EPISODE_RENTALS_EPISODE,
  EPISODE_RENTALS_READERS,
  EPISODE_RENTALS_SCENARIO,
  episodeRentalPath,
} from "../src/scenarios/episode-rentals";
import { signInAsMember } from "../src/storefront";
import {
  localeStorefrontPath,
  WEB_ADMIN_RENTALS_BASE_URL,
  WEB_STOREFRONT_RENTALS_BASE_URL,
} from "../src/urls";
import { turnToEndPage } from "../src/viewer";

/**
 * A tip on the site, as `docs/<locale>/4-console/4-selling-episodes.md` shows
 * it: the control at the end of an episode, the dialog it opens, and the tip
 * under **Purchase history**.
 *
 * It is photographed on the tenant of `db/seeds/scenarios/550_episode_rentals.sql`,
 * whose tips are on and whose reader holds the episode and gave a tip on it.
 * The site offers a tip only while a provider is ready, whose credentials no
 * seed can write, so this takes the tenant's payments as its checkout suite
 * does. Everything it does is on that tenant, which the suite starts over.
 */
const PAGE = "console/selling-episodes";

/**
 * Sign the reader in and open `path` in `locale`: where a sign-in returns to
 * carries no locale, so the language is the address opened afterwards.
 */
const openAsTipper = async (page: Page, locale: string, path: string) => {
  await signInAsMember(
    page,
    EPISODE_RENTALS_READERS.tipper,
    "/",
    WEB_STOREFRONT_RENTALS_BASE_URL
  );
  await page.goto(
    `${WEB_STOREFRONT_RENTALS_BASE_URL}${localeStorefrontPath(locale, path)}`
  );
};

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  applyScenarioSql(EPISODE_RENTALS_SCENARIO);
  uploadEpisodePages(EPISODE_RENTALS_EPISODE.publicId);

  const page = await browser.newPage();

  try {
    await takePaymentsThroughStripe(
      page,
      EPISODE_RENTALS_ADMIN,
      WEB_ADMIN_RENTALS_BASE_URL
    );
  } finally {
    await page.close();
  }
});

test.afterAll(() => {
  applyScenarioSql(EPISODE_RENTALS_SCENARIO);
});

for (const locale of DOCS_LOCALES) {
  const t = (key: string): string => docsText(locale, key);

  test.describe(`web-storefront tip documentation screenshots in ${locale}`, () => {
    test("the control at the end of an episode, and its dialog", async ({
      page,
    }) => {
      await openAsTipper(page, locale, episodeRentalPath);

      const control = page.getByRole("button", {
        name: t("storefront.episode.tip.button"),
      });

      expect(await turnToEndPage(page, control)).toBe(true);

      await expectDocsScreenshot(page, {
        element: page.getByRole("region", {
          name: t("storefront.episode.viewer.end_page"),
        }),
        locale,
        page: PAGE,
        subject: "tip-control",
      });

      await control.click();

      await expectDocsScreenshot(page, {
        element: page.getByRole("dialog"),
        locale,
        page: PAGE,
        subject: "tip-dialog",
      });
    });

    test("the tip under Purchase history", async ({ page }) => {
      await openAsTipper(page, locale, "/my/library");

      await expectDocsScreenshot(page, {
        element: docsSection(page, t("storefront.library.history_heading")),
        locale,
        page: PAGE,
        subject: "tip-purchase-history",
      });
    });
  });
}
