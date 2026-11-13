import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { selectOption } from "../src/admin";
import type { ConsoleSessions } from "../src/console-sessions";
import { test } from "../src/console-sessions";
import { runSql } from "../src/db";
import {
  DOCS_LOCALES,
  docsField,
  docsLabelPattern,
  docsScreen,
  docsScreenHeader,
  docsSection,
  docsText,
  expectDocsScreenshot,
  setDocsLocale,
} from "../src/docs-screenshots";
import {
  ANALYTICS_ADMIN,
  ANALYTICS_TENANT,
  ANALYTICS_WEEK,
} from "../src/scenarios/admin-analytics";
import { SEED_ADMIN } from "../src/scenarios/admin-publish";
import { COMMENT_MODERATION_ADMIN } from "../src/scenarios/comment-moderation";
import { DOCS_SUBSCRIPTION_PLANS } from "../src/scenarios/docs-subscription-plans";
import {
  PROMOTION_CODES,
  PROMOTION_CODES_ADMIN,
  PROMOTION_CODES_READER,
} from "../src/scenarios/promotion-codes";
import { ROYALTIES_ADMIN, ROYALTIES_SALES } from "../src/scenarios/royalties";
import { STOREFRONT_SUBSCRIPTIONS_ADMIN } from "../src/scenarios/storefront-subscriptions";
import {
  WEB_ADMIN_ANALYTICS_BASE_URL,
  WEB_ADMIN_BASE_URL,
  WEB_ADMIN_COMMENT_MODERATION_BASE_URL,
  WEB_ADMIN_PROMOTION_CODES_BASE_URL,
  WEB_ADMIN_ROYALTIES_BASE_URL,
  WEB_ADMIN_SUBSCRIPTIONS_BASE_URL,
} from "../src/urls";

/**
 * The tenant console's payments and reports, as
 * `docs/<locale>/4-console/4-selling-episodes.md`,
 * `5-subscription-plans.md`, and `6-reports-and-royalties.md` show them.
 *
 * Payment methods are photographed on the seed tenant with Stripe chosen and nothing
 * saved, which is what the form shows while a Tenant admin follows the
 * setup. The promotion codes are photographed on the tenant of
 * `db/seeds/scenarios/790_promotion_codes.sql`, whose seeded code a reader
 * redeemed on a fixed day. The royalties are photographed on the royalty tenant of
 * `db/seeds/scenarios/260_royalties.sql`, whose sales all fall in one past
 * month, opened by its period so the screen does not move with today's
 * date; nothing here closes it. The month before it is a statement
 * `db/seeds/scenarios/460_docs_royalties.sql` writes as closed on a fixed day.
 * The providers a tenant holds are photographed on the analytics tenant of
 * `db/seeds/scenarios/690_admin_analytics.sql`, whose payment settings no
 * other shot reads.
 * The subscription plans are photographed on the subscriptions tenant of
 * `db/seeds/scenarios/670_storefront_subscriptions.sql`, beside the two plans
 * `680_docs_subscription_plans.sql` adds to it. The cohorts are photographed
 * on the analytics tenant of `db/seeds/scenarios/690_admin_analytics.sql`,
 * whose one week of sign-ups is long over, so every week of it is counted.
 */
test.use({ baseURL: WEB_ADMIN_BASE_URL });

const SERIES = "SeedSERSAAA1";

/** Sign in as the seed tenant's admin and open `path` in `locale`. */
const openScreen = async (
  page: Page,
  consoleSessions: ConsoleSessions,
  locale: string,
  path: string
): Promise<void> => {
  await consoleSessions.signIn(page, SEED_ADMIN, WEB_ADMIN_BASE_URL);
  await setDocsLocale(page, WEB_ADMIN_BASE_URL, locale);
  await page.goto(path);
};

/** The same on the promotion codes tenant's console. */
const openPromotionCodes = async (
  page: Page,
  consoleSessions: ConsoleSessions,
  locale: string,
  path: string
): Promise<void> => {
  await consoleSessions.signIn(
    page,
    PROMOTION_CODES_ADMIN,
    WEB_ADMIN_PROMOTION_CODES_BASE_URL
  );
  await setDocsLocale(page, WEB_ADMIN_PROMOTION_CODES_BASE_URL, locale);
  await page.goto(`${WEB_ADMIN_PROMOTION_CODES_BASE_URL}${path}`);
};

/** The same on the subscriptions tenant's console. */
const openSubscriptionPlans = async (
  page: Page,
  consoleSessions: ConsoleSessions,
  locale: string,
  path: string
): Promise<void> => {
  await consoleSessions.signIn(
    page,
    STOREFRONT_SUBSCRIPTIONS_ADMIN,
    WEB_ADMIN_SUBSCRIPTIONS_BASE_URL
  );
  await setDocsLocale(page, WEB_ADMIN_SUBSCRIPTIONS_BASE_URL, locale);
  await page.goto(`${WEB_ADMIN_SUBSCRIPTIONS_BASE_URL}${path}`);
};

/** The same on the royalty tenant's console. */
const openRoyalties = async (
  page: Page,
  consoleSessions: ConsoleSessions,
  locale: string,
  path: string
): Promise<void> => {
  await consoleSessions.signIn(
    page,
    ROYALTIES_ADMIN,
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

      test("an episode's price and reading period", async ({
        consoleSessions,
        page,
      }) => {
        await openScreen(
          page,
          consoleSessions,
          locale,
          `/series/${SERIES}/episodes/new`
        );

        await expectDocsScreenshot(page, {
          element: [
            docsField(
              page.getByRole("spinbutton", {
                name: docsLabelPattern(
                  locale,
                  "admin.series.episodes.form.price"
                ),
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

      test("an episode's rental price and rental period", async ({
        consoleSessions,
        page,
      }) => {
        await openScreen(
          page,
          consoleSessions,
          locale,
          `/series/${SERIES}/episodes/new`
        );

        await expectDocsScreenshot(page, {
          element: [
            docsField(
              page.getByRole("spinbutton", {
                name: t("admin.series.episodes.form.rental_price"),
              })
            ),
            docsField(
              page.getByRole("spinbutton", {
                name: t("admin.series.episodes.form.rental_period"),
              })
            ),
          ],
          locale,
          page: sellingPage,
          subject: "rental",
        });
      });

      for (const [subject, provider, webhookPath] of [
        ["stripe-settings", "Stripe", "stripe"],
        ["payjp-settings", "PAY.JP", "payjp"],
      ] as const) {
        test(`the payment settings, with ${provider} chosen`, async ({
          consoleSessions,
          page,
        }) => {
          await openScreen(
            page,
            consoleSessions,
            locale,
            "/integrations/payment"
          );
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
        test(`the ${subject} section`, async ({ consoleSessions, page }) => {
          await openScreen(
            page,
            consoleSessions,
            locale,
            "/integrations/payment"
          );

          await expectDocsScreenshot(page, {
            element: docsSection(page, t(title)),
            locale,
            page: sellingPage,
            subject,
          });
        });
      }

      // The seed tenant takes no tips, so the card is photographed as a
      // Tenant admin fills it in, before it is saved.
      test("the tips section", async ({ consoleSessions, page }) => {
        await openScreen(
          page,
          consoleSessions,
          locale,
          "/integrations/payment"
        );
        const tips = docsSection(page, t("admin.settings.tips.title"));
        const amounts = tips.getByRole("spinbutton");

        const add = tips.getByRole("button", {
          name: t("admin.settings.tips.amounts_add"),
        });

        await tips
          .getByRole("switch", { name: t("admin.settings.tips.enabled") })
          .click();
        await amounts.nth(0).fill("100");
        await add.click();
        await amounts.nth(1).fill("300");
        await add.click();
        await amounts.nth(2).fill("1000");

        await expectDocsScreenshot(page, {
          element: tips,
          locale,
          page: sellingPage,
          subject: "tips",
        });
      });
    });

    test.describe("promotion codes", () => {
      const sellingPage = "console/selling-episodes";

      test("the form that creates a promotion code", async ({
        consoleSessions,
        page,
      }) => {
        await openPromotionCodes(
          page,
          consoleSessions,
          locale,
          "/promotion-codes/new"
        );
        await expect(
          page.getByRole("button", {
            name: t("admin.promotion_codes.form.submit"),
          })
        ).toBeVisible();

        await expectDocsScreenshot(page, {
          element: docsScreen(page),
          locale,
          page: sellingPage,
          subject: "promotion-code-form",
        });
      });

      test("a promotion code, with its redemptions", async ({
        consoleSessions,
        page,
      }) => {
        await openPromotionCodes(
          page,
          consoleSessions,
          locale,
          `/promotion-codes?code=${PROMOTION_CODES.welcome.id}`
        );

        const detail = page.getByRole("dialog", {
          exact: true,
          name: t("admin.promotion_codes.detail_title"),
        });

        await expect(
          detail.getByRole("cell", { name: PROMOTION_CODES_READER.email })
        ).toBeVisible();

        await expectDocsScreenshot(page, {
          element: detail,
          locale,
          page: sellingPage,
          subject: "promotion-code-detail",
        });
      });
    });

    test.describe("subscription plans", () => {
      const plansPage = "console/subscription-plans";

      test("the list of plans", async ({ consoleSessions, page }) => {
        await openSubscriptionPlans(
          page,
          consoleSessions,
          locale,
          "/subscription-plans"
        );
        await expect(
          page.getByRole("cell", {
            exact: true,
            name: DOCS_SUBSCRIPTION_PLANS.yearly.name,
          })
        ).toBeVisible();

        await expectDocsScreenshot(page, {
          element: docsScreen(page),
          locale,
          page: plansPage,
          subject: "list",
        });
      });

      test("a plan of a label", async ({ consoleSessions, page }) => {
        await openSubscriptionPlans(
          page,
          consoleSessions,
          locale,
          `/subscription-plans/${DOCS_SUBSCRIPTION_PLANS.yearly.publicId}`
        );
        await expect(
          page.getByRole("button", {
            name: t("admin.subscription_plans.form.update"),
          })
        ).toBeVisible();

        await expectDocsScreenshot(page, {
          element: docsScreen(page),
          locale,
          page: plansPage,
          subject: "form",
        });
      });
    });

    test.describe("reports and royalties", () => {
      const reportsPage = "console/reports-and-royalties";

      test("the dashboard, with a draft and a scheduled episode", async ({
        consoleSessions,
        page,
      }) => {
        // On the moderation tenant, whose series
        // `db/seeds/scenarios/450_docs_publishing.sql` gives an episode in
        // each of the two states the publishing queue lists.
        await consoleSessions.signIn(
          page,
          COMMENT_MODERATION_ADMIN,
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

      test("Episodes' read-through, below the dates it covers", async ({
        consoleSessions,
        page,
      }) => {
        await openScreen(page, consoleSessions, locale, "/analytics/episodes");

        // From the figures down: the line above them names the last 28 days,
        // which move with the day the shot is taken.
        await expectDocsScreenshot(page, {
          element: [
            page.getByRole("main").locator("dl").first(),
            docsSection(page, t("admin.analytics.episodes.list_title")),
          ],
          locale,
          page: reportsPage,
          subject: "read-through",
        });
      });

      test("Cohorts, with the Funnel below it", async ({
        consoleSessions,
        page,
      }) => {
        // Tall enough for the funnel below the cohort table.
        await page.setViewportSize({ height: 1400, width: 1280 });
        const path = `/analytics/cohorts?from=${ANALYTICS_WEEK.from}&to=${ANALYTICS_WEEK.to}`;
        await consoleSessions.signIn(
          page,
          ANALYTICS_ADMIN,
          WEB_ADMIN_ANALYTICS_BASE_URL
        );
        await setDocsLocale(page, WEB_ADMIN_ANALYTICS_BASE_URL, locale);
        await page.goto(`${WEB_ADMIN_ANALYTICS_BASE_URL}${path}`);

        await expectDocsScreenshot(page, {
          element: [
            docsSection(page, t("admin.analytics.cohorts.table_title")),
            docsSection(page, t("admin.analytics.funnel.title")),
          ],
          locale,
          page: reportsPage,
          subject: "cohorts",
        });
      });

      test("an open month", async ({ consoleSessions, page }) => {
        // Tall enough for the month's lines below its totals.
        await page.setViewportSize({ height: 1400, width: 1280 });
        await openRoyalties(
          page,
          consoleSessions,
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

      test("closing a month", async ({ consoleSessions, page }) => {
        await openRoyalties(
          page,
          consoleSessions,
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

      test("the closed statements", async ({ consoleSessions, page }) => {
        await openRoyalties(
          page,
          consoleSessions,
          locale,
          "/royalties/statements"
        );

        await expectDocsScreenshot(page, {
          element: [docsScreenHeader(page), page.getByRole("row").last()],
          locale,
          page: reportsPage,
          subject: "closed-statements",
        });
      });

      test("a closed month's statement", async ({ consoleSessions, page }) => {
        // December 2025, which `db/seeds/scenarios/460_docs_royalties.sql`
        // closes on a fixed day.
        await openRoyalties(
          page,
          consoleSessions,
          locale,
          "/royalties/statements/2025-12"
        );

        await expectDocsScreenshot(page, {
          element: [docsScreenHeader(page), page.getByRole("row").last()],
          locale,
          page: reportsPage,
          subject: "statement",
        });
      });

      test("how months are closed", async ({ consoleSessions, page }) => {
        await openRoyalties(
          page,
          consoleSessions,
          locale,
          "/royalties/settings"
        );

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

/** A provider's credentials, as `addProvider` enters them. */
interface ProviderCredentials {
  /** The provider's own name, which no catalog translates. */
  name: string;
  /**
   * The catalog key of the label of its secret key and of its webhook secret,
   * each with the value entered.
   */
  fields: readonly [
    readonly [key: string, value: string],
    readonly [key: string, value: string],
  ];
}

const STRIPE_CREDENTIALS: ProviderCredentials = {
  fields: [
    ["admin.settings.payment.fields.stripe.secret_key", "sk_test_docs1234"],
    ["admin.settings.payment.fields.stripe.webhook_secret", "whsec_docs1234"],
  ],
  name: "Stripe",
};

const PAYJP_CREDENTIALS: ProviderCredentials = {
  fields: [
    ["admin.settings.payment.fields.payjp.secret_key", "sk_test_docs5678"],
    ["admin.settings.payment.fields.payjp.webhook_token", "whook_docs5678"],
  ],
  name: "PAY.JP",
};

/**
 * Adding a provider saves it on the analytics tenant, so every locale's copy
 * runs in order on one worker and starts by deleting the providers the one
 * before it added. The tenant itself is left alone rather than applied again:
 * it is counted on the Platform Console's dashboard, which another shot takes
 * meanwhile, and its file is applied again before its own suite runs.
 */
test.describe("web-admin payment providers documentation screenshots", () => {
  test.describe.configure({ mode: "default" });

  for (const locale of DOCS_LOCALES) {
    const t = (key: string): string => docsText(locale, key);

    /** Adds `provider` through the form, turned on, with its credentials. */
    const addProvider = async (
      page: Page,
      provider: ProviderCredentials
    ): Promise<void> => {
      const form = page.getByRole("region", {
        exact: true,
        name: t("admin.settings.payment.add_title"),
      });

      await selectOption(
        page,
        form.getByRole("combobox", {
          name: t("admin.settings.payment.provider"),
        }),
        provider.name
      );
      await form
        .getByRole("checkbox", { name: t("admin.settings.payment.enabled") })
        .click();

      // One after the other: a fill moves the focus the other one types into.
      const [secretKey, webhookSecret] = provider.fields;
      await form
        .getByLabel(docsLabelPattern(locale, secretKey[0]))
        .fill(secretKey[1]);
      await form
        .getByLabel(docsLabelPattern(locale, webhookSecret[0]))
        .fill(webhookSecret[1]);

      await form
        .getByRole("button", {
          exact: true,
          name: t("admin.settings.payment.add_submit"),
        })
        .click();
      await expect(
        page.getByRole("region", { exact: true, name: provider.name })
      ).toBeVisible();
    };

    test(`the providers a tenant holds, in ${locale}`, async ({
      consoleSessions,
      page,
    }) => {
      runSql(`
        DELETE FROM tenant_payment_providers
        WHERE tenant_id IN (
          SELECT id FROM tenants WHERE public_id = '${ANALYTICS_TENANT.publicId}'
        );
        DELETE FROM tenant_payment_config
        WHERE tenant_id IN (
          SELECT id FROM tenants WHERE public_id = '${ANALYTICS_TENANT.publicId}'
        );
      `);
      await consoleSessions.signIn(
        page,
        ANALYTICS_ADMIN,
        WEB_ADMIN_ANALYTICS_BASE_URL
      );
      await setDocsLocale(page, WEB_ADMIN_ANALYTICS_BASE_URL, locale);
      await page.goto(`${WEB_ADMIN_ANALYTICS_BASE_URL}/integrations/payment`);

      await addProvider(page, STRIPE_CREDENTIALS);
      await addProvider(page, PAYJP_CREDENTIALS);
      // Again, without the toasts the two additions raised.
      await page.reload();

      const settings = docsSection(page, t("admin.settings.payment.title"));
      await expect(
        settings.getByRole("region", { exact: true, name: "PAY.JP" })
      ).toBeVisible();

      await expectDocsScreenshot(page, {
        element: settings,
        locale,
        page: "console/selling-episodes",
        subject: "providers",
      });
    });
  }
});
