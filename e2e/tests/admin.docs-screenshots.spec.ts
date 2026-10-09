import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  signInAsAdmin,
  signInAsAnnouncementBannerAdmin,
  signInAsSeedAdmin,
} from "../src/admin";
import {
  DOCS_LOCALES,
  docsScreenHeader,
  docsSection,
  docsText,
  docsTextPattern,
  expectDocsScreenshot,
  setDocsLocale,
} from "../src/docs-screenshots";
import { ADMIN_MFA_SETTINGS_ADMIN } from "../src/scenarios/admin-mfa-settings";
import { CONTACT_WORKFLOW_EDITOR } from "../src/scenarios/contact-workflow";
import { totpCode } from "../src/totp";
import {
  WEB_ADMIN_ANNOUNCEMENT_BANNER_BASE_URL,
  WEB_ADMIN_BASE_URL,
  WEB_ADMIN_CONTACT_WORKFLOW_BASE_URL,
} from "../src/urls";

/**
 * The tenant console as the overview under `docs/<locale>/4-console/` and the
 * pages under `docs/<locale>/4-console/3-setup/` show it: signing in, the
 * sidebar, the tenant's settings, branding, pages, announcements, members,
 * mail, audit log, and a member's own account.
 *
 * Each test takes the region one passage explains and compares it with the
 * image beside that page, so a change to the console that alters a documented
 * screen fails here until the image is regenerated. The seed tenant holds
 * most of what these screens show; the announcement list is photographed on
 * the banner tenant, given three announcements by
 * `db/seeds/scenarios/430_docs_announcements.sql`, the invitation list is
 * given two by `440_docs_members.sql`, and two-step verification is turned on
 * for the account `370_admin_mfa_settings.sql` keeps for it. A form is filled
 * in where a passage explains what filling it in opens, and is never saved.
 */
test.use({ baseURL: WEB_ADMIN_BASE_URL });

/** The seed tenant's page that the site's privacy policy is written on. */
const PAGE_ID = "018f1000-0001-7000-8000-000000000001";

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

/** The same on the banner tenant's console, which holds the announcements. */
const openBannerTenant = async (
  page: Page,
  locale: string,
  path: string
): Promise<void> => {
  await signInAsAnnouncementBannerAdmin(page, path);
  await setDocsLocale(page, WEB_ADMIN_ANNOUNCEMENT_BANNER_BASE_URL, locale);
  await page.goto(`${WEB_ADMIN_ANNOUNCEMENT_BANNER_BASE_URL}${path}`);
};

for (const locale of DOCS_LOCALES) {
  const t = (key: string): string => docsText(locale, key);

  test.describe(`web-admin documentation screenshots in ${locale}`, () => {
    test("the sign-in screen, for Signing in on the console's overview", async ({
      page,
    }) => {
      await setDocsLocale(page, WEB_ADMIN_BASE_URL, locale);
      await page.goto("/login");

      await expect(
        page.getByRole("heading", { level: 1, name: "Publira" })
      ).toBeVisible();

      await expectDocsScreenshot(page, {
        element: page.getByRole("main"),
        locale,
        page: "console",
        subject: "sign-in",
      });
    });

    test("a Tenant admin's sidebar, for Roles on the console's overview", async ({
      page,
    }) => {
      // Tall enough for the whole sidebar, which scrolls inside itself at the
      // project's height.
      await page.setViewportSize({ height: 1400, width: 1280 });
      await openScreen(page, locale, "/");

      const sidebar = page.getByRole("navigation").first();
      await expectDocsScreenshot(page, {
        element: [
          sidebar.getByRole("link").first(),
          sidebar.getByRole("link").last(),
        ],
        locale,
        page: "console",
        subject: "sidebar",
      });
    });

    test("the sidebar groups the setup pages are in", async ({ page }) => {
      await page.setViewportSize({ height: 1400, width: 1280 });
      await openScreen(page, locale, "/");

      const sidebar = page.getByRole("navigation").first();
      await expectDocsScreenshot(page, {
        element: [
          sidebar.getByText(t("admin.nav.site"), { exact: true }),
          sidebar.getByRole("link").last(),
        ],
        locale,
        page: "console/setup",
        subject: "sidebar",
      });
    });

    test.describe("settings", () => {
      test("the General tab", async ({ page }) => {
        await openScreen(page, locale, "/settings");

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            docsSection(page, t("admin.settings.site.title")),
          ],
          locale,
          page: "console/setup/settings",
          subject: "public-site-display",
        });
      });

      test("a card as an Editor sees it", async ({ page }) => {
        // The help desk tenant has an Editor, and the seed tenant none.
        await signInAsAdmin(
          page,
          CONTACT_WORKFLOW_EDITOR,
          "/settings",
          WEB_ADMIN_CONTACT_WORKFLOW_BASE_URL
        );
        await setDocsLocale(page, WEB_ADMIN_CONTACT_WORKFLOW_BASE_URL, locale);
        await page.goto(`${WEB_ADMIN_CONTACT_WORKFLOW_BASE_URL}/settings`);

        await expectDocsScreenshot(page, {
          element: docsSection(page, t("admin.settings.site.title")),
          locale,
          page: "console/setup/settings",
          subject: "read-only",
        });
      });

      for (const [subject, title] of [
        ["time-zone", "admin.settings.timezone.title"],
        ["default-language", "admin.settings.default_locale.title"],
        ["reader-comments", "admin.settings.comments.title"],
        ["age-verification", "admin.settings.age_verification.title"],
        ["terms-and-privacy-policy", "admin.settings.legal_pages.title"],
        ["refused-email-addresses", "admin.settings.email_rejection.title"],
      ] as const) {
        test(`the ${subject} card`, async ({ page }) => {
          await openScreen(page, locale, "/settings");

          await expectDocsScreenshot(page, {
            element: docsSection(page, t(title)),
            locale,
            page: "console/setup/settings",
            subject,
          });
        });
      }

      for (const [subject, title] of [
        ["community-limits", "admin.settings.policy.community.title"],
        ["retention-periods", "admin.settings.policy.retention.title"],
      ] as const) {
        test(`the ${subject} form on Limits and retention`, async ({
          page,
        }) => {
          await openScreen(page, locale, "/settings/policy");

          await expectDocsScreenshot(page, {
            element: docsSection(page, t(title)),
            locale,
            page: "console/setup/settings",
            subject,
          });
        });
      }
    });

    test.describe("branding", () => {
      test("the logo and the icon", async ({ page }) => {
        await openScreen(page, locale, "/branding");

        await expectDocsScreenshot(page, {
          element: [
            docsSection(page, t("admin.settings.logo.title")),
            docsSection(page, t("admin.settings.icon.title")),
          ],
          locale,
          page: "console/setup/branding",
          subject: "logo-and-icon",
        });
      });

      for (const [subject, title] of [
        ["colors", "admin.settings.theme.groups.brand.title"],
        ["typefaces", "admin.settings.theme.typefaces.title"],
      ] as const) {
        test(`the theme's ${subject}`, async ({ page }) => {
          await openScreen(page, locale, "/branding");

          await expectDocsScreenshot(page, {
            element: docsSection(page, t(title)),
            locale,
            page: "console/setup/branding",
            subject,
          });
        });
      }

      test("the theme's preview", async ({ page }) => {
        await openScreen(page, locale, "/branding");
        await page
          .getByRole("tab", { name: t("admin.settings.theme.tabs.preview") })
          .click();

        await expectDocsScreenshot(page, {
          element: page.getByRole("tabpanel"),
          locale,
          page: "console/setup/branding",
          subject: "preview",
        });
      });
    });

    test.describe("pages", () => {
      test("the page list", async ({ page }) => {
        await openScreen(page, locale, "/pages");

        await expectDocsScreenshot(page, {
          element: [docsScreenHeader(page), page.getByRole("row").last()],
          locale,
          page: "console/setup/pages",
          subject: "list",
        });
      });

      test("the form that creates a page", async ({ page }) => {
        await openScreen(page, locale, "/pages/new");

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            page.getByRole("button", { name: t("admin.pages.form.create") }),
          ],
          locale,
          page: "console/setup/pages",
          subject: "create-form",
        });
      });

      test("a page's edit screen, with its languages", async ({ page }) => {
        await openScreen(page, locale, `/pages/${PAGE_ID}`);

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            page.getByRole("button", { name: t("admin.pages.workspace.save") }),
          ],
          locale,
          page: "console/setup/pages",
          subject: "editor",
        });
      });

      test("a page's versions", async ({ page }) => {
        await openScreen(page, locale, `/pages/${PAGE_ID}`);

        await expectDocsScreenshot(page, {
          element: docsSection(page, t("admin.pages.workspace.versions_title")),
          locale,
          page: "console/setup/pages",
          subject: "versions",
        });
      });
    });

    test.describe("announcements", () => {
      test("the announcement list, with its Banner column", async ({
        page,
      }) => {
        await openBannerTenant(page, locale, "/announcements");

        await expectDocsScreenshot(page, {
          element: [docsScreenHeader(page), page.getByRole("row").last()],
          locale,
          page: "console/setup/announcements",
          subject: "list",
        });
      });

      test("the form that creates an announcement", async ({ page }) => {
        await openBannerTenant(page, locale, "/announcements/new");

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            page.getByRole("button", {
              name: t("admin.announcements.form.submit"),
            }),
          ],
          locale,
          page: "console/setup/announcements",
          subject: "create-form",
        });
      });
    });

    test.describe("members", () => {
      for (const [subject, title] of [
        ["invite", "admin.members.invite_title"],
        ["list", "admin.members.list_title"],
        ["invitations", "admin.members.invitations_title"],
      ] as const) {
        test(`the ${subject} section`, async ({ page }) => {
          await openScreen(page, locale, "/members");

          await expectDocsScreenshot(page, {
            element: docsSection(page, t(title)),
            locale,
            page: "console/setup/members",
            subject,
          });
        });
      }
    });

    test.describe("email", () => {
      test("the tenant's own SMTP server, turned on", async ({ page }) => {
        await openScreen(page, locale, "/integrations/email");
        await page
          .getByRole("checkbox", {
            name: t("admin.settings.email.override"),
          })
          .check();

        await expectDocsScreenshot(page, {
          element: docsSection(page, t("admin.settings.email.title")),
          locale,
          page: "console/setup/email",
          subject: "outgoing",
        });
      });

      test("the connection test", async ({ page }) => {
        // Tall enough for the dialog and the form behind it.
        await page.setViewportSize({ height: 1400, width: 1280 });
        await openScreen(page, locale, "/integrations/email");
        await page
          .getByRole("checkbox", {
            name: t("admin.settings.email.override"),
          })
          .check();
        await page
          .getByRole("button", { name: t("admin.settings.email.test") })
          .click();

        await expectDocsScreenshot(page, {
          element: page.getByRole("dialog"),
          locale,
          page: "console/setup/email",
          subject: "test-connection",
        });
      });

      test("receiving replies, turned on", async ({ page }) => {
        await openScreen(page, locale, "/integrations/email");
        const inbound = docsSection(
          page,
          t("admin.settings.inbound_email.title")
        );
        await inbound
          .getByRole("checkbox", {
            name: t("admin.settings.inbound_email.enabled"),
          })
          .check();

        await expectDocsScreenshot(page, {
          element: inbound,
          locale,
          page: "console/setup/email",
          subject: "inbound",
        });
      });
    });

    test("the audit log, with its filters", async ({ page }) => {
      // The seeded entries alone: the spec that turns on two-step
      // verification adds entries of its own, dated today.
      await openScreen(
        page,
        locale,
        "/audit-logs?from=2026-04-01&to=2026-04-30"
      );

      await expectDocsScreenshot(page, {
        element: [docsScreenHeader(page), page.getByRole("row").nth(5)],
        locale,
        page: "console/setup/audit-log",
        subject: "list",
      });
    });

    test.describe("your account", () => {
      test("the account menu", async ({ page }) => {
        await openScreen(page, locale, "/");
        const trigger = page.getByRole("button", {
          name: docsTextPattern(locale, "admin.shell.account_menu"),
        });
        await trigger.click();

        await expectDocsScreenshot(page, {
          element: [trigger, page.getByRole("menu")],
          locale,
          page: "console/setup/your-account",
          subject: "menu",
        });
      });

      test("changing your email address", async ({ page }) => {
        await openScreen(page, locale, "/settings/account");

        await expectDocsScreenshot(page, {
          element: docsSection(page, t("admin.settings.email_change.title")),
          locale,
          page: "console/setup/your-account",
          subject: "email-address",
        });
      });

      test("turning two-step verification on, and signing in with it", async ({
        page,
      }) => {
        await signInAsAdmin(
          page,
          ADMIN_MFA_SETTINGS_ADMIN,
          "/settings/account"
        );
        await setDocsLocale(page, WEB_ADMIN_BASE_URL, locale);
        await page.goto("/settings/account");
        const card = docsSection(page, t("admin.settings.mfa.title"));

        await expectDocsScreenshot(page, {
          element: card,
          locale,
          page: "console/setup/your-account",
          subject: "two-step",
        });

        await card
          .getByRole("button", {
            exact: true,
            name: t("admin.settings.mfa.enable_submit"),
          })
          .click();
        const qrCode = page.getByRole("img", {
          name: t("admin.auth.mfa.enroll_qr_label"),
        });
        const setupKey = page.getByText(/^[A-Z2-7]{16,}$/u);
        await expect(setupKey).toBeVisible();
        const setupKeyText = await setupKey.textContent();
        const secret = setupKeyText?.trim() ?? "";

        // The QR code and the key are drawn for this setup alone, so they are
        // covered over: no other run shows the same ones.
        await expectDocsScreenshot(page, {
          element: card,
          locale,
          mask: [qrCode, setupKey],
          page: "console/setup/your-account",
          subject: "two-step-setup",
        });

        await page
          .getByLabel(t("admin.auth.mfa.code_label"))
          .fill(totpCode(secret));
        await page
          .getByRole("button", {
            name: t("admin.auth.mfa.enroll_confirm_submit"),
          })
          .click();
        const recoveryCodes = page.getByRole("listitem").getByRole("code");
        await expect(recoveryCodes).toHaveCount(10);

        await expectDocsScreenshot(page, {
          element: card,
          locale,
          mask: [recoveryCodes],
          page: "console/setup/your-account",
          subject: "recovery-codes",
        });

        // Signed out, signing in again stops at the code. The sign-in helpers
        // find the form by its English copy, so the language waits until then.
        await page.context().clearCookies();
        await signInAsAdmin(page, ADMIN_MFA_SETTINGS_ADMIN, "/");
        await expect(page).toHaveURL(/\/mfa/u);
        await setDocsLocale(page, WEB_ADMIN_BASE_URL, locale);
        await page.reload();

        await expectDocsScreenshot(page, {
          element: page.getByRole("main"),
          locale,
          page: "console",
          subject: "two-step-code",
        });
      });
    });
  });
}
