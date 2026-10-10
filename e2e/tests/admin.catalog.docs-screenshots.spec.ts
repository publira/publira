import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin, signInAsSeedAdmin } from "../src/admin";
import {
  DOCS_LOCALES,
  docsField,
  docsScreen,
  docsScreenHeader,
  docsSection,
  docsText,
  expectDocsScreenshot,
  setDocsLocale,
} from "../src/docs-screenshots";
import { SEED_CATALOG } from "../src/scenarios/admin-publish";
import {
  COMMENT_MODERATION_ADMIN,
  COMMENT_MODERATION_EPISODE,
} from "../src/scenarios/comment-moderation";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import {
  WEB_ADMIN_BASE_URL,
  WEB_ADMIN_COMMENT_MODERATION_BASE_URL,
} from "../src/urls";

/**
 * The tenant console's catalog screens, as the pages under
 * `docs/<locale>/4-console/1-catalog/` show them: the series, episodes,
 * labels, Authors, Author roles, and genres the seed tenant holds.
 *
 * Nothing here saves anything. A dialog is opened and left unsubmitted, and a
 * checkbox ticked to open one is never saved, so the catalog stays the one
 * the other screenshot projects photograph. The seed publishes every episode
 * it writes, so the episode list is photographed on the moderation tenant,
 * whose series `db/seeds/scenarios/450_docs_publishing.sql` gives a scheduled
 * episode and a draft.
 */
test.use({ baseURL: WEB_ADMIN_BASE_URL });

const SERIES = SEED_TENANT.series.publicId;
const EPISODE = "SeedEPSDAAA1";

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

for (const locale of DOCS_LOCALES) {
  const t = (key: string): string => docsText(locale, key);

  test.describe(`web-admin catalog documentation screenshots in ${locale}`, () => {
    test("the sidebar's Catalog group, for Publishing works", async ({
      page,
    }) => {
      await openScreen(page, locale, "/series");

      const sidebar = page.getByRole("navigation").first();
      await expectDocsScreenshot(page, {
        element: [
          sidebar.getByText(t("admin.nav.catalog"), { exact: true }),
          sidebar.getByRole("link", { name: t("admin.nav.genres_label") }),
        ],
        locale,
        page: "console/catalog",
        subject: "catalog-group",
      });
    });

    test.describe("series", () => {
      test("the series list, with its filters and row actions", async ({
        page,
      }) => {
        await openScreen(page, locale, "/series");

        await expectDocsScreenshot(page, {
          element: [docsScreenHeader(page), page.getByRole("row").nth(3)],
          locale,
          page: "console/catalog/series",
          subject: "list",
        });
      });

      test.describe("the series form", () => {
        test.beforeEach(async ({ page }) => {
          await openScreen(page, locale, "/series/new");
          await expect(
            page.getByRole("heading", {
              level: 1,
              name: t("admin.series.new_title"),
            })
          ).toBeVisible();
        });

        test("what readers see first", async ({ page }) => {
          await expectDocsScreenshot(page, {
            element: [
              docsScreenHeader(page),
              docsField(
                page.getByRole("combobox", {
                  name: t("admin.series.form.label"),
                })
              ),
            ],
            locale,
            page: "console/catalog/series",
            subject: "create-form",
          });
        });

        test("genres and tags", async ({ page }) => {
          await expectDocsScreenshot(page, {
            element: [
              docsField(
                page.getByRole("combobox", {
                  exact: true,
                  name: t("admin.series.form.genres"),
                })
              ),
              docsField(
                page.getByRole("combobox", {
                  name: t("admin.series.form.tags"),
                })
              ),
            ],
            locale,
            page: "console/catalog/series",
            subject: "genres-and-tags",
          });
        });

        test("the cover image field", async ({ page }) => {
          await expectDocsScreenshot(page, {
            element: docsField(
              page.getByRole("button", {
                exact: true,
                name: t("admin.series.form.eye_catch"),
              })
            ),
            locale,
            page: "console/catalog/series",
            subject: "cover-image-field",
          });
        });

        test("the publication date and time", async ({ page }) => {
          await expectDocsScreenshot(page, {
            element: docsField(
              page.getByRole("textbox", {
                name: t("admin.series.form.published_at"),
              })
            ),
            locale,
            page: "console/catalog/series",
            subject: "publication-date",
          });
        });

        test("Shown on and Sold on", async ({ page }) => {
          await expectDocsScreenshot(page, {
            element: [
              docsField(
                page.getByRole("combobox", {
                  name: t("admin.series.form.availability"),
                })
              ),
              docsField(
                page.getByRole("combobox", {
                  name: t("admin.series.form.purchase_availability"),
                })
              ),
            ],
            locale,
            page: "console/catalog/series",
            subject: "shown-on-and-sold-on",
          });
        });

        test("the serialization status and update schedule", async ({
          page,
        }) => {
          await expectDocsScreenshot(page, {
            element: [
              docsField(
                page.getByRole("combobox", {
                  name: t("admin.series.form.status"),
                })
              ),
              docsField(
                page.getByRole("group", {
                  name: t("admin.series.form.schedule"),
                })
              ),
            ],
            locale,
            page: "console/catalog/series",
            subject: "serialization",
          });
        });

        test("the age rating", async ({ page }) => {
          await expectDocsScreenshot(page, {
            element: docsField(
              page.getByRole("combobox", {
                name: t("admin.series.form.age_rating"),
              })
            ),
            locale,
            page: "console/catalog/series",
            subject: "age-rating",
          });
        });

        test("how comments are published", async ({ page }) => {
          await expectDocsScreenshot(page, {
            element: docsField(
              page.getByRole("combobox", {
                name: t("admin.series.form.comment_mode"),
              })
            ),
            locale,
            page: "console/catalog/series",
            subject: "comments",
          });
        });

        test("the reading direction and spreads", async ({ page }) => {
          await expectDocsScreenshot(page, {
            element: [
              docsField(
                page.getByRole("combobox", {
                  name: t("admin.series.form.reading_direction"),
                })
              ),
              docsField(
                page.getByRole("spinbutton", {
                  name: t("admin.series.form.spread_start"),
                })
              ),
            ],
            locale,
            page: "console/catalog/series",
            subject: "reading-direction",
          });
        });

        test("the reading period", async ({ page }) => {
          await expectDocsScreenshot(page, {
            element: docsField(
              page.getByRole("spinbutton", {
                name: t("admin.series.form.reading_period"),
              })
            ),
            locale,
            page: "console/catalog/series",
            subject: "reading-period",
          });
        });
      });

      test("the cover image tab, with its four shapes", async ({ page }) => {
        await openScreen(page, locale, `/series/${SERIES}?tab=eye-catch`);

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            docsSection(page, t("admin.eye_catch.aspect.title")),
          ],
          locale,
          page: "console/catalog/series",
          subject: "cover-image",
        });
      });

      test("Free if you wait, below the series form", async ({ page }) => {
        await openScreen(page, locale, `/series/${SERIES}`);

        await expectDocsScreenshot(page, {
          element: docsSection(page, t("admin.series.wait_free.title")),
          locale,
          page: "console/catalog/series",
          subject: "free-if-you-wait",
        });
      });
    });

    test.describe("episodes", () => {
      const episodesPath = `/series/${SERIES}/episodes`;
      const editPath = `${episodesPath}/${EPISODE}`;

      test("the episode list, with an episode in each state", async ({
        page,
      }) => {
        const path = `/series/${COMMENT_MODERATION_EPISODE.seriesPublicId}/episodes`;
        await signInAsAdmin(
          page,
          COMMENT_MODERATION_ADMIN,
          path,
          WEB_ADMIN_COMMENT_MODERATION_BASE_URL
        );
        await setDocsLocale(
          page,
          WEB_ADMIN_COMMENT_MODERATION_BASE_URL,
          locale
        );
        await page.goto(`${WEB_ADMIN_COMMENT_MODERATION_BASE_URL}${path}`);

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            page
              .getByRole("link", {
                exact: true,
                name: t("admin.series.episodes.edit_action"),
              })
              .nth(2),
          ],
          locale,
          page: "console/catalog/episodes",
          subject: "list",
        });
      });

      test("the form that creates an episode", async ({ page }) => {
        await openScreen(page, locale, `${episodesPath}/new`);

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            page.getByRole("button", {
              name: t("admin.series.episodes.form.create"),
            }),
          ],
          locale,
          page: "console/catalog/episodes",
          subject: "create-form",
        });
      });

      for (const [subject, title] of [
        ["title", "admin.series.episodes.rename.title"],
        ["price-and-reading-period", "admin.series.episodes.pricing.title"],
        ["add-pages", "admin.series.episodes.pages.title"],
        ["registered-pages", "admin.series.episodes.image_list_title"],
        ["page-layout", "admin.series.episodes.layout.title"],
        ["credits", "admin.series.episodes.credits.title"],
        ["free-reading-periods", "admin.series.episodes.free_windows.title"],
        ["publishing-settings", "admin.series.episodes.schedule_title"],
      ] as const) {
        test(`the ${subject} section of the episode's edit screen`, async ({
          page,
        }) => {
          await openScreen(page, locale, editPath);

          await expectDocsScreenshot(page, {
            element: docsSection(page, t(title)),
            locale,
            page: "console/catalog/episodes",
            subject,
          });
        });
      }

      test("Shown on and Sold on, on the episode's edit screen", async ({
        page,
      }) => {
        await openScreen(page, locale, editPath);

        await expectDocsScreenshot(page, {
          element: [
            docsSection(page, t("admin.series.episodes.availability.title")),
            docsSection(
              page,
              t("admin.series.episodes.purchase_availability.title")
            ),
          ],
          locale,
          page: "console/catalog/episodes",
          subject: "shown-on-and-sold-on",
        });
      });

      test.describe("the episode list's dialogs", () => {
        test.beforeEach(async ({ page }) => {
          await openScreen(page, locale, episodesPath);
          // Three episodes, as an editor about to change their credits
          // together would pick them. Nothing is saved.
          // The first is Select all on this page.
          const boxes = page.getByRole("main").getByRole("checkbox");
          await boxes.nth(1).check();
          await boxes.nth(2).check();
          await boxes.nth(3).check();
        });

        test("the credits of many episodes at once", async ({ page }) => {
          // Tall enough for the whole dialog, which scrolls inside itself at
          // the project's height and would be photographed cut off.
          await page.setViewportSize({ height: 1600, width: 1280 });
          await page
            .getByRole("button", {
              exact: true,
              name: t("admin.series.episodes.credits_action"),
            })
            .click();

          await expectDocsScreenshot(page, {
            element: page.getByRole("dialog"),
            locale,
            page: "console/catalog/episodes",
            subject: "bulk-credits",
          });
        });

        test("a free reading period on many episodes at once", async ({
          page,
        }) => {
          await page
            .getByRole("button", {
              exact: true,
              name: t("admin.series.episodes.free_windows.bulk_action"),
            })
            .click();

          await expectDocsScreenshot(page, {
            element: page.getByRole("dialog"),
            locale,
            page: "console/catalog/episodes",
            subject: "bulk-free-reading-period",
          });
        });
      });
    });

    test.describe("labels", () => {
      test("the label list", async ({ page }) => {
        await openScreen(page, locale, "/labels");

        await expectDocsScreenshot(page, {
          element: [docsScreenHeader(page), page.getByRole("row").nth(3)],
          locale,
          page: "console/catalog/labels",
          subject: "list",
        });
      });

      test("the form that creates a label", async ({ page }) => {
        await openScreen(page, locale, "/labels/new");

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            page.getByRole("button", { name: t("admin.labels.form.create") }),
          ],
          locale,
          page: "console/catalog/labels",
          subject: "create-form",
        });
      });

      test("a label's page, with its two tabs", async ({ page }) => {
        await openScreen(page, locale, `/labels/${SEED_CATALOG.labelPublicId}`);

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            page.getByRole("button", { name: t("admin.labels.form.update") }),
          ],
          locale,
          page: "console/catalog/labels",
          subject: "edit",
        });
      });
    });

    test.describe("Authors and Author roles", () => {
      test("the Author list", async ({ page }) => {
        await openScreen(page, locale, "/creators");

        await expectDocsScreenshot(page, {
          element: [docsScreenHeader(page), page.getByRole("row").nth(3)],
          locale,
          page: "console/catalog/authors",
          subject: "list",
        });
      });

      test("the form that creates an Author", async ({ page }) => {
        await openScreen(page, locale, "/creators/new");

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            page.getByRole("button", { name: t("admin.creators.form.create") }),
          ],
          locale,
          page: "console/catalog/authors",
          subject: "create-form",
        });
      });

      test("the reader accounts linked to an Author", async ({ page }) => {
        await openScreen(
          page,
          locale,
          `/creators/${SEED_CATALOG.creatorPublicId}`
        );

        await expectDocsScreenshot(page, {
          element: docsSection(page, t("admin.creators.accounts.title")),
          locale,
          page: "console/catalog/authors",
          subject: "reader-accounts",
        });
      });

      test("the Author roles", async ({ page }) => {
        await openScreen(page, locale, "/creator-roles");

        await expectDocsScreenshot(page, {
          element: docsScreen(page),
          locale,
          page: "console/catalog/authors",
          subject: "roles",
        });
      });

      test("the credits on a series", async ({ page }) => {
        await openScreen(page, locale, `/series/${SERIES}`);

        await expectDocsScreenshot(page, {
          element: docsField(
            page.getByRole("group", { name: t("admin.series.form.creators") })
          ),
          locale,
          page: "console/catalog/authors",
          subject: "credits",
        });
      });
    });

    test("the genre list", async ({ page }) => {
      await openScreen(page, locale, "/genres");

      await expectDocsScreenshot(page, {
        element: docsScreen(page),
        locale,
        page: "console/catalog/genres",
        subject: "list",
      });
    });
  });
}
