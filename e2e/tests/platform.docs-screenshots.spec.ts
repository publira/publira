import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  DOCS_LOCALES,
  docsField,
  docsScreenHeader,
  docsSection,
  docsText,
  docsTextPattern,
  expectDocsScreenshot,
  setDocsLocale,
} from "../src/docs-screenshots";
import { signInAsPlatformOperator } from "../src/platform";
import {
  DOCS_PLATFORM_AUDITOR,
  DOCS_PLATFORM_OPERATOR,
  DOCS_PLATFORM_TENANT,
} from "../src/scenarios/docs-platform";
import { SEED_PLATFORM_SUPER_ADMIN } from "../src/scenarios/platform-tenants";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

/**
 * The Platform Console as the pages under `docs/<locale>/3-operations/` show
 * it apart from its services: signing in, operators, an operator's own
 * account, the platform's defaults and policies, notifications, and the
 * audit log.
 *
 * Each test takes the region one passage explains and compares it with the
 * image beside that page, so a change to the console that alters a documented
 * screen fails here until the image is regenerated. The operators other than
 * the seeded super admin, the notification, and the audit log entries are
 * written by `db/seeds/scenarios/470_docs_platform.sql`, with fixed dates. A
 * form is filled in where a passage explains what filling it in shows, and is
 * never saved.
 */
test.use({ baseURL: WEB_PLATFORM_BASE_URL });

/** Sign in as `credentials` and open `path` in `locale`. */
const openScreen = async (
  page: Page,
  locale: string,
  path: string,
  credentials: { email: string; password: string } = SEED_PLATFORM_SUPER_ADMIN
): Promise<void> => {
  await signInAsPlatformOperator(page, credentials, path);
  await setDocsLocale(page, WEB_PLATFORM_BASE_URL, locale);
  await page.goto(path);
};

for (const locale of DOCS_LOCALES) {
  const t = (key: string): string => docsText(locale, key);

  test.describe(`web-platform documentation screenshots in ${locale}`, () => {
    test.describe("the Platform Console and publiractl", () => {
      test("the sign-in screen", async ({ page }) => {
        await setDocsLocale(page, WEB_PLATFORM_BASE_URL, locale);
        await page.goto("/login");

        await expect(
          page.getByRole("link", {
            name: t("platform.auth.login.forgot_password"),
          })
        ).toBeVisible();

        await expectDocsScreenshot(page, {
          element: page.getByRole("main"),
          locale,
          page: "operations/platform-console",
          subject: "sign-in",
        });
      });

      test("a change made from the command line in the audit log", async ({
        page,
      }) => {
        await openScreen(
          page,
          locale,
          `/audit-logs?tenant_id=${DOCS_PLATFORM_TENANT.publicId}&action=tenant_created`
        );

        await expect(page.locator("tbody tr")).toHaveCount(1);

        await expectDocsScreenshot(page, {
          element: page.getByRole("table"),
          locale,
          page: "operations/platform-console",
          subject: "audit-log-command-line",
        });
      });

      test("the operator list", async ({ page }) => {
        await openScreen(page, locale, "/operators");

        await expect(
          page.getByText(DOCS_PLATFORM_AUDITOR.name, { exact: true })
        ).toBeVisible();

        await expectDocsScreenshot(page, {
          element: [docsScreenHeader(page), page.getByRole("table")],
          locale,
          page: "operations/platform-console",
          subject: "operators",
        });
      });

      test("adding an operator", async ({ page }) => {
        await openScreen(page, locale, "/operators/new");

        await expectDocsScreenshot(page, {
          element: [docsScreenHeader(page), page.locator("main form")],
          locale,
          page: "operations/platform-console",
          subject: "add-operator",
        });
      });

      test("an operator's page, for changing their role and suspending them", async ({
        page,
      }) => {
        await openScreen(
          page,
          locale,
          `/operators/${DOCS_PLATFORM_AUDITOR.publicId}`
        );

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            docsSection(page, t("platform.operators.info_title")),
          ],
          locale,
          page: "operations/platform-console",
          subject: "operator",
        });
      });

      test("the account menu", async ({ page }) => {
        await openScreen(page, locale, "/");

        const button = page.getByRole("button", {
          name: docsTextPattern(locale, "platform.shell.account_menu"),
        });
        await button.click();
        const settings = page.getByRole("menuitem", {
          name: t("platform.shell.account_settings"),
        });
        await expect(settings).toBeVisible();

        await expectDocsScreenshot(page, {
          element: [button, page.getByRole("menu")],
          locale,
          page: "operations/platform-console",
          subject: "account-menu",
        });
      });

      test("changing an operator's own email address", async ({ page }) => {
        await openScreen(page, locale, "/account");

        await expectDocsScreenshot(page, {
          element: docsSection(page, t("platform.settings.email_change_title")),
          locale,
          page: "operations/platform-console",
          subject: "account-settings",
        });
      });
    });

    test.describe("platform defaults and policies", () => {
      test("where the settings are in the sidebar", async ({ page }) => {
        await openScreen(page, locale, "/general");

        const sidebar = page.getByRole("navigation").first();
        await expectDocsScreenshot(page, {
          element: [
            sidebar.getByText(t("platform.nav.platform"), { exact: true }),
            sidebar.getByRole("link", {
              name: t("platform.nav.retention_label"),
            }),
          ],
          locale,
          page: "operations/platform-policies",
          subject: "sidebar",
        });
      });

      test("General settings", async ({ page }) => {
        await openScreen(page, locale, "/general");

        await expectDocsScreenshot(page, {
          element: [
            docsSection(page, t("platform.settings.default_locale_title")),
            docsSection(page, t("platform.settings.default_timezone_title")),
          ],
          locale,
          page: "operations/platform-policies",
          subject: "general",
        });
      });

      test("requiring two-step verification of tenant administrators", async ({
        page,
      }) => {
        await openScreen(page, locale, "/policies/security");

        await expectDocsScreenshot(page, {
          element: docsField(
            page.getByRole("checkbox", {
              name: t("platform.policy.security.mfa_required"),
            })
          ),
          locale,
          page: "operations/platform-policies",
          subject: "mfa-required",
        });
      });

      test("the rate limits on Security", async ({ page }) => {
        await openScreen(page, locale, "/policies/security");

        await expectDocsScreenshot(page, {
          element: [
            docsField(
              page.getByLabel(t("platform.policy.security.password_per_minute"))
            ),
            docsField(
              page.getByLabel(
                t("platform.policy.security.wait_free_ticket_use_per_day")
              )
            ),
          ],
          locale,
          page: "operations/platform-policies",
          subject: "rate-limits",
        });
      });

      test("the sign-in attempt limits on Security", async ({ page }) => {
        await openScreen(page, locale, "/policies/security");

        await expectDocsScreenshot(page, {
          element: docsField(
            page.getByLabel(
              t(
                "platform.policy.security.login_attempts_per_account_per_minute"
              )
            )
          ),
          locale,
          page: "operations/platform-policies",
          subject: "sign-in-attempts",
        });
      });

      test("the disposable email domain list", async ({ page }) => {
        await openScreen(page, locale, "/policies/security");

        await expectDocsScreenshot(page, {
          element: docsField(
            page.getByRole("textbox", {
              name: t("platform.policy.security.disposable_email_domains_url"),
            })
          ),
          locale,
          page: "operations/platform-policies",
          subject: "disposable-email-domains",
        });
      });

      test("Community limits", async ({ page }) => {
        await openScreen(page, locale, "/policies/community");

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            page.getByRole("button", {
              name: t("platform.policy.community.save"),
            }),
          ],
          locale,
          page: "operations/platform-policies",
          subject: "community",
        });
      });

      test("Retention defaults", async ({ page }) => {
        await openScreen(page, locale, "/policies/retention");

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            page.getByRole("button", {
              name: t("platform.policy.retention.save"),
            }),
          ],
          locale,
          page: "operations/platform-policies",
          subject: "retention",
        });
      });
    });

    test("an episode that could not be published, under Notifications", async ({
      page,
    }) => {
      await openScreen(page, locale, "/notifications", DOCS_PLATFORM_OPERATOR);

      await expect(
        page
          .getByRole("main")
          .getByText(t("platform.notifications.events.publish_failed_title"))
      ).toBeVisible();

      await expectDocsScreenshot(page, {
        element: [docsScreenHeader(page), page.getByRole("table")],
        locale,
        page: "operations/scheduled-jobs",
        subject: "notifications",
      });
    });

    test.describe("securing an install", () => {
      test("requiring two-step verification and saving the policy", async ({
        page,
      }) => {
        await openScreen(page, locale, "/policies/security");

        await expectDocsScreenshot(page, {
          element: [
            docsField(
              page.getByRole("checkbox", {
                name: t("platform.policy.security.mfa_required"),
              })
            ),
            page.getByRole("button", {
              name: t("platform.policy.security.save"),
            }),
          ],
          locale,
          page: "operations/security",
          subject: "mfa-required",
        });
      });

      test("the audit log narrowed to one tenant", async ({ page }) => {
        await openScreen(
          page,
          locale,
          `/audit-logs?tenant_id=${DOCS_PLATFORM_TENANT.publicId}`
        );

        await expect(
          page.getByText(
            docsTextPattern(locale, "platform.audit.tenant_filter"),
            { exact: true }
          )
        ).toBeVisible();

        await expectDocsScreenshot(page, {
          element: [docsScreenHeader(page), page.getByRole("table")],
          locale,
          page: "operations/security",
          subject: "audit-logs",
        });
      });
    });
  });
}
