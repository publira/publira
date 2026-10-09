import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  querySql,
  restorePlatformSettingsRow,
  runSql,
  snapshotPlatformSettingsRow,
} from "../src/db";
import {
  DOCS_LOCALES,
  docsField,
  docsLabelPattern,
  docsScreenHeader,
  docsSection,
  docsText,
  docsTextPattern,
  expectDocsScreenshot,
  setDocsLocale,
} from "../src/docs-screenshots";
import { signInAsSeedPlatformSuperAdmin } from "../src/platform";
import {
  platformEmailSettingsTag,
  platformSearchSettingsTag,
  platformStorageSettingsTag,
  revalidatePlatformTags,
} from "../src/revalidate";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

/**
 * The services the Platform Console configures, as
 * `docs/<locale>/3-operations/` shows them on the pages about object storage,
 * email, search, Web Push, and securing an install.
 *
 * Three states these pages explain are not the stack's own: an access key and
 * an SMTP password that are saved, and a search engine whose index failed to
 * build. A test that needs one saves it, takes its shots, and puts the row
 * `task e2e:db` saved back however it ended. The key it saves is the one the
 * stack already signs with, so the images keep loading meanwhile. The files
 * of this project run beside one another and the tests of one file in order,
 * so no other shot photographs these screens while a test has changed them.
 */
test.use({ baseURL: WEB_PLATFORM_BASE_URL });

const ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID?.trim() || "publira";
const SECRET_ACCESS_KEY =
  process.env.AWS_SECRET_ACCESS_KEY?.trim() || "publirapass";

/**
 * Where the search build is pointed when it has to fail: a port nothing on
 * the stack listens on, so the worker's every attempt fails the same way.
 */
const UNREACHABLE_ENGINE_URL = "http://127.0.0.1:9";

/** Sign in as the seeded super admin and open `path` in `locale`. */
const openScreen = async (
  page: Page,
  locale: string,
  path: string
): Promise<void> => {
  await signInAsSeedPlatformSuperAdmin(page, path);
  await setDocsLocale(page, WEB_PLATFORM_BASE_URL, locale);
  await page.goto(path);
};

for (const locale of DOCS_LOCALES) {
  const t = (key: string): string => docsText(locale, key);
  /** The two kinds of credential on the storage screen, and what each holds. */
  const credentials = (page: Page) =>
    page.getByRole("group", {
      name: t("platform.storage.credentials.legend"),
    });

  test.describe(`web-platform service documentation screenshots in ${locale}`, () => {
    test.describe("object storage", () => {
      test("the bucket's settings", async ({ page }) => {
        await openScreen(page, locale, "/services/storage");

        await expectDocsScreenshot(page, {
          element: [
            docsField(
              page.getByRole("textbox", {
                name: docsLabelPattern(locale, "platform.storage.form.bucket"),
              })
            ),
            docsField(
              page.getByRole("checkbox", {
                name: t("platform.storage.form.force_path_style"),
              })
            ),
          ],
          locale,
          page: "operations/object-storage",
          subject: "bucket",
        });
      });

      test("the two kinds of credential", async ({ page }) => {
        await openScreen(page, locale, "/services/storage");

        await expectDocsScreenshot(page, {
          element: credentials(page),
          locale,
          page: "operations/object-storage",
          subject: "credentials",
        });
      });

      test("a connection test that fails", async ({ page }) => {
        await openScreen(page, locale, "/services/storage");

        await page
          .getByRole("textbox", {
            name: docsLabelPattern(locale, "platform.storage.form.bucket"),
          })
          .fill("publira-missing");
        await page
          .getByRole("button", { name: t("platform.storage.test.submit") })
          .click();
        const failed = page.getByText(t("platform.storage.test.failed_checks"));
        await expect(failed).toBeVisible();

        await expectDocsScreenshot(page, {
          // The innermost box that holds both the test's title and its steps.
          element: page
            .getByRole("main")
            .locator("div")
            .filter({
              has: page.getByText(t("platform.storage.test.title"), {
                exact: true,
              }),
            })
            .filter({
              has: page.getByRole("list", {
                name: t("platform.storage.test.steps"),
              }),
            })
            .last(),
          locale,
          page: "operations/object-storage",
          subject: "connection-test",
        });
      });

      test("a saved access key", async ({ page }) => {
        const saved = snapshotPlatformSettingsRow("platform_storage_config");
        try {
          await openScreen(page, locale, "/services/storage");
          await page
            .getByRole("radio", {
              name: t("platform.storage.credentials.access_key"),
            })
            .check();
          await page
            .getByRole("textbox", {
              name: docsLabelPattern(
                locale,
                "platform.storage.credentials.access_key_id"
              ),
            })
            .fill(ACCESS_KEY_ID);
          await page
            .getByLabel(
              docsLabelPattern(
                locale,
                "platform.storage.credentials.secret_access_key"
              )
            )
            .fill(SECRET_ACCESS_KEY);
          await page
            .getByRole("button", { name: t("platform.storage.save") })
            .click();
          await expect(
            page.getByText(t("platform.storage.saved"))
          ).toBeVisible();

          await page.reload();
          await expect(
            page.getByText(t("platform.storage.credentials.secret_stored"))
          ).toBeVisible();

          await expectDocsScreenshot(page, {
            element: [
              credentials(page),
              page.getByRole("button", { name: t("platform.storage.save") }),
            ],
            locale,
            page: "operations/object-storage",
            subject: "saved-access-key",
          });
          await expectDocsScreenshot(page, {
            element: credentials(page),
            locale,
            page: "operations/security",
            subject: "replace-access-key",
          });
        } finally {
          restorePlatformSettingsRow("platform_storage_config", saved);
          await revalidatePlatformTags([platformStorageSettingsTag]);
        }
      });
    });

    test.describe("email", () => {
      test("the platform's SMTP account", async ({ page }) => {
        await openScreen(page, locale, "/services/email");

        await expectDocsScreenshot(page, {
          element: docsSection(page, t("platform.settings.smtp_card_title")),
          locale,
          page: "operations/email",
          subject: "smtp-settings",
        });
      });

      test("the SMTP connection test", async ({ page }) => {
        await openScreen(page, locale, "/services/email");

        await page
          .getByRole("button", { name: t("platform.settings.smtp_test") })
          .click();
        const dialog = page.getByRole("dialog");
        await expect(
          dialog.getByText(t("platform.settings.smtp_test_title"))
        ).toBeVisible();

        await expectDocsScreenshot(page, {
          element: dialog,
          locale,
          page: "operations/email",
          subject: "connection-test",
        });
      });

      test("a saved password", async ({ page }) => {
        const saved = snapshotPlatformSettingsRow("platform_smtp_config");
        try {
          await openScreen(page, locale, "/services/email");
          await page
            .getByRole("textbox", { name: t("platform.settings.username") })
            .fill("mailer");
          await page
            .getByLabel(t("platform.settings.password"), { exact: true })
            .fill("docs-screenshots-password");
          await page
            .getByRole("button", {
              exact: true,
              name: t("platform.common.save"),
            })
            .click();
          await expect(
            page.getByText(t("platform.settings.smtp_saved"))
          ).toBeVisible();

          await page.reload();
          const change = page.getByRole("button", {
            name: t("platform.settings.password_change"),
          });
          await expect(change).toBeVisible();

          await expectDocsScreenshot(page, {
            element: [
              docsField(
                page.getByRole("textbox", {
                  name: t("platform.settings.username"),
                })
              ),
              docsField(change),
            ],
            locale,
            page: "operations/email",
            subject: "saved-password",
          });
          await expectDocsScreenshot(page, {
            element: docsField(change),
            locale,
            page: "operations/security",
            subject: "smtp-password",
          });
        } finally {
          restorePlatformSettingsRow("platform_smtp_config", saved);
          await revalidatePlatformTags([platformEmailSettingsTag]);
        }
      });
    });

    test.describe("search", () => {
      test("moving to OpenSearch", async ({ page }) => {
        await openScreen(page, locale, "/services/search");

        await page.getByRole("radio", { name: /^OpenSearch/u }).check();
        await expect(
          page.getByRole("textbox", {
            name: docsLabelPattern(locale, "platform.search.form.url"),
          })
        ).toBeVisible();

        await expectDocsScreenshot(page, {
          element: docsSection(page, t("platform.search.title")),
          locale,
          page: "operations/search",
          subject: "engine",
        });
      });

      test("an index that failed to build, and the text analysis", async ({
        page,
      }) => {
        // An install that never left PostgreSQL has no row at all, which is
        // what `task e2e:db` leaves.
        const saved = snapshotPlatformSettingsRow("platform_search_config");
        try {
          runSql(`
            INSERT INTO platform_search_config (engine, url, index_alias)
            VALUES ('opensearch', '${UNREACHABLE_ENGINE_URL}', 'publira-catalog')
            ON CONFLICT (singleton) DO UPDATE
            SET engine = EXCLUDED.engine,
                url = EXCLUDED.url,
                index_alias = EXCLUDED.index_alias,
                revision = platform_search_config.revision + 1,
                updated_at = NOW();
          `);
          // The worker looks for an index to build every 30 seconds, and its
          // first attempt is what writes the error the screen shows.
          await expect
            .poll(
              () =>
                querySql(
                  "SELECT COALESCE(build_error, '') FROM platform_search_config;"
                ),
              { timeout: 90_000 }
            )
            .not.toBe("");
          await revalidatePlatformTags([platformSearchSettingsTag]);

          await openScreen(page, locale, "/services/search");
          const failedAt = page.getByText(
            docsTextPattern(locale, "platform.search.status.failed_at")
          );
          await expect(failedAt).toBeVisible();

          await expectDocsScreenshot(page, {
            element: docsSection(page, t("platform.search.status.title")),
            locale,
            // Every later attempt of the worker writes its own time.
            mask: [failedAt],
            page: "operations/search",
            subject: "build-failed",
          });
          await expectDocsScreenshot(page, {
            element: docsSection(page, t("platform.search.analysis.title")),
            locale,
            page: "operations/search",
            subject: "text-analysis",
          });
        } finally {
          if (saved) {
            restorePlatformSettingsRow("platform_search_config", saved);
          } else {
            runSql("DELETE FROM platform_search_config;");
          }
          await revalidatePlatformTags([platformSearchSettingsTag]);
        }
      });
    });

    test("Web Push", async ({ page }) => {
      await openScreen(page, locale, "/services/webpush");

      await expectDocsScreenshot(page, {
        element: [
          docsScreenHeader(page),
          page.getByRole("button", { name: t("platform.webpush.save") }),
        ],
        locale,
        page: "operations/web-push",
        subject: "settings",
      });
    });
  });
}
