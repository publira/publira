import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { selectOption, signInAsAdmin, signInAsSeedAdmin } from "../src/admin";
import {
  DOCS_LOCALES,
  docsField,
  docsScreenHeader,
  docsSection,
  docsText,
  expectDocsScreenshot,
  setDocsLocale,
} from "../src/docs-screenshots";
import { COMMENT_MODERATION_ADMIN } from "../src/scenarios/comment-moderation";
import { ROYALTIES_ADMIN, ROYALTIES_SALES } from "../src/scenarios/royalties";
import {
  WEB_ADMIN_BASE_URL,
  WEB_ADMIN_COMMENT_MODERATION_BASE_URL,
  WEB_ADMIN_ROYALTIES_BASE_URL,
} from "../src/urls";

/**
 * The tenant console's payments and reports, as
 * `docs/<locale>/4-console/4-selling-episodes.md` and
 * `5-reports-and-royalties.md` show them.
 *
 * Payments are photographed on the seed tenant with Stripe chosen and nothing
 * saved, which is what the form shows while a Tenant admin follows the
 * setup. The royalties are photographed on the royalty tenant of
 * `db/seeds/scenarios/260_royalties.sql`, whose sales all fall in one past
 * month, opened by its period so the screen does not move with today's
 * date; nothing here closes it. The month before it is a statement
 * `db/seeds/scenarios/460_docs_royalties.sql` writes as closed on a fixed day.
 */
test.use({ baseURL: WEB_ADMIN_BASE_URL });

const SERIES = "SeedSERSAAA1";

/** Sign in as the seed tenant's admin and open `path` in `locale`. */
const openScreen = async (
  page: Page,
  locale: string,
  path: string
): Promise<void> => {
  await signInAsSeedAdmin(page, path);
  await setDocsLocale(page, WEB_ADMIN_BASE_URL, locale);
  await page.goto(path);
};

/** The same on the royalty tenant's console. */
const openRoyalties = async (
  page: Page,
  locale: string,
  path: string
): Promise<void> => {
  await signInAsAdmin(
    page,
    ROYALTIES_ADMIN,
    path,
    WEB_ADMIN_ROYALTIES_BASE_URL
  );
  await setDocsLocale(page, WEB_ADMIN_ROYALTIES_BASE_URL, locale);
  await page.goto(`${WEB_ADMIN_ROYALTIES_BASE_URL}${path}`);
};

for (const locale of DOCS_LOCALES) {
  const t = (key: string): string => docsText(locale, key);

  test.describe(`web-admin selling and reports documentation screenshots in ${locale}`, () => {
    test.describe("selling episodes", () => {
      const sellingPage = "console/selling-episodes";

      test("an episode's price and reading period", async ({ page }) => {
        await openScreen(page, locale, `/series/${SERIES}/episodes/new`);

        await expectDocsScreenshot(page, {
          element: [
            docsField(
              page.getByRole("spinbutton", {
                name: t("admin.series.episodes.form.price"),
              })
            ),
            docsField(
              page.getByRole("spinbutton", {
                name: t("admin.series.episodes.form.reading_period"),
              })
            ),
          ],
          locale,
          page: sellingPage,
          subject: "price-and-reading-period",
        });
      });

      for (const [subject, provider, webhookPath] of [
        ["stripe-settings", "Stripe", "stripe"],
        ["payjp-settings", "PAY.JP", "payjp"],
      ] as const) {
        test(`the payment settings, with ${provider} chosen`, async ({
          page,
        }) => {
          await openScreen(page, locale, "/integrations/payment");
          const settings = docsSection(page, t("admin.settings.payment.title"));
          // The provider's own name, which no catalog translates.
          await selectOption(
            page,
            settings.getByRole("combobox", {
              name: t("admin.settings.payment.provider"),
            }),
            provider
          );
          await expect(
            settings.getByRole("textbox", {
              name: t("admin.settings.payment.webhook_url"),
            })
          ).toHaveValue(new RegExp(`/webhook/payment/${webhookPath}$`, "u"));

          await expectDocsScreenshot(page, {
            element: settings,
            locale,
            page: sellingPage,
            subject,
          });
        });
      }

      for (const [subject, title] of [
        ["where-sold", "admin.settings.purchase.title"],
        ["in-app-purchase", "admin.settings.store_payment.title"],
        ["store-products", "admin.settings.store_products.title"],
      ] as const) {
        test(`the ${subject} section`, async ({ page }) => {
          await openScreen(page, locale, "/integrations/payment");

          await expectDocsScreenshot(page, {
            element: docsSection(page, t(title)),
            locale,
            page: sellingPage,
            subject,
          });
        });
      }
    });

    test.describe("reports and royalties", () => {
      const reportsPage = "console/reports-and-royalties";

      test("the dashboard, with a draft and a scheduled episode", async ({
        page,
      }) => {
        // On the moderation tenant, whose series
        // `db/seeds/scenarios/450_docs_publishing.sql` gives an episode in
        // each of the two states the publishing queue lists.
        await signInAsAdmin(
          page,
          COMMENT_MODERATION_ADMIN,
          "/",
          WEB_ADMIN_COMMENT_MODERATION_BASE_URL
        );
        await setDocsLocale(
          page,
          WEB_ADMIN_COMMENT_MODERATION_BASE_URL,
          locale
        );
        await page.goto(WEB_ADMIN_COMMENT_MODERATION_BASE_URL);

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            docsSection(page, t("admin.dashboard.queue_title")),
          ],
          locale,
          page: reportsPage,
          subject: "dashboard",
        });
      });

      test("Read-through, below the dates it covers", async ({ page }) => {
        await openScreen(page, locale, "/engagement");

        // From the figures down: the line above them names the last 28 days,
        // which move with the day the shot is taken.
        await expectDocsScreenshot(page, {
          element: [
            page.getByRole("main").locator("dl").first(),
            docsSection(page, t("admin.engagement.list_title")),
          ],
          locale,
          page: reportsPage,
          subject: "read-through",
        });
      });

      test("an open month", async ({ page }) => {
        // Tall enough for the month's lines below its totals.
        await page.setViewportSize({ height: 1400, width: 1280 });
        await openRoyalties(
          page,
          locale,
          `/royalties?period=${ROYALTIES_SALES.period}`
        );

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            docsSection(page, t("admin.royalties.lines.title")),
          ],
          locale,
          page: reportsPage,
          subject: "open-month",
        });
      });

      test("closing a month", async ({ page }) => {
        await openRoyalties(
          page,
          locale,
          `/royalties?period=${ROYALTIES_SALES.period}`
        );
        await page
          .getByRole("button", { name: t("admin.royalties.close.button") })
          .click();

        await expectDocsScreenshot(page, {
          element: page.getByRole("alertdialog").or(page.getByRole("dialog")),
          locale,
          page: reportsPage,
          subject: "close-month",
        });
      });

      test("the closed statements", async ({ page }) => {
        await openRoyalties(page, locale, "/royalties/statements");

        await expectDocsScreenshot(page, {
          element: [docsScreenHeader(page), page.getByRole("row").last()],
          locale,
          page: reportsPage,
          subject: "closed-statements",
        });
      });

      test("a closed month's statement", async ({ page }) => {
        // December 2025, which `db/seeds/scenarios/460_docs_royalties.sql`
        // closes on a fixed day.
        await openRoyalties(page, locale, "/royalties/statements/2025-12");

        await expectDocsScreenshot(page, {
          element: [docsScreenHeader(page), page.getByRole("row").last()],
          locale,
          page: reportsPage,
          subject: "statement",
        });
      });

      test("how months are closed", async ({ page }) => {
        await openRoyalties(page, locale, "/royalties/settings");

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            page.getByRole("button", {
              name: t("admin.settings.royalties.submit"),
            }),
          ],
          locale,
          page: reportsPage,
          subject: "closing-settings",
        });
      });
    });
  });
}
