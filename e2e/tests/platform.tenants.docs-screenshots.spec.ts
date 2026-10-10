import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  DOCS_LOCALES,
  docsScreen,
  docsScreenHeader,
  docsSection,
  docsText,
  expectDocsScreenshot,
  setDocsLocale,
} from "../src/docs-screenshots";
import { signInAsSeedPlatformSuperAdmin } from "../src/platform";
import {
  DOCS_PLATFORM_READER,
  DOCS_PLATFORM_SUSPENDED_READER,
  DOCS_PLATFORM_SUSPENDED_TENANT,
  DOCS_PLATFORM_TENANT,
} from "../src/scenarios/docs-platform";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

/**
 * The Platform Console's tenants, their staff, and their readers, as
 * `docs/<locale>/3-operations/` shows them on the pages about tenants, a
 * tenant's staff, and users.
 *
 * The tenants, staff, readers, and invitations photographed here are written
 * by `db/seeds/scenarios/470_docs_platform.sql`, with fixed dates, on two
 * tenants of their own: the tenant console's screenshots photograph the seed
 * tenant's readers and staff. Nothing is filled in or saved.
 */
test.use({ baseURL: WEB_PLATFORM_BASE_URL });

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

const TENANT_PATH = `/tenants/${DOCS_PLATFORM_TENANT.publicId}`;
const MEMBERS_PATH = `${TENANT_PATH}/members`;

for (const locale of DOCS_LOCALES) {
  const t = (key: string): string => docsText(locale, key);

  test.describe(`web-platform tenant documentation screenshots in ${locale}`, () => {
    test.describe("tenants", () => {
      test("the create form", async ({ page }) => {
        await openScreen(page, locale, "/tenants/new");

        await expectDocsScreenshot(page, {
          element: [docsScreenHeader(page), page.locator("main form")],
          locale,
          page: "operations/tenants",
          subject: "create-tenant",
        });
      });

      test("a tenant's profile and domain settings", async ({ page }) => {
        await openScreen(page, locale, TENANT_PATH);

        await expectDocsScreenshot(page, {
          element: [
            docsSection(page, t("platform.tenants.basic_title")),
            docsSection(page, t("platform.tenants.domain_settings_title")),
          ],
          locale,
          page: "operations/tenants",
          subject: "profile-domain",
        });
      });

      test("Suspend at the top of a tenant's page", async ({ page }) => {
        await openScreen(page, locale, TENANT_PATH);

        await expectDocsScreenshot(page, {
          element: docsScreenHeader(page),
          locale,
          page: "operations/tenants",
          subject: "suspend",
        });
      });

      test("a suspended tenant", async ({ page }) => {
        await openScreen(
          page,
          locale,
          `/tenants/${DOCS_PLATFORM_SUSPENDED_TENANT.publicId}`
        );

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            docsSection(page, t("platform.tenants.basic_title")),
          ],
          locale,
          page: "operations/tenants",
          subject: "suspended",
        });
      });

      test("the dashboard's tenant counts", async ({ page }) => {
        await openScreen(page, locale, "/");

        await expectDocsScreenshot(page, {
          element: page.locator("main dl").filter({
            has: page.getByText(t("platform.dashboard.stats.suspended_label")),
          }),
          locale,
          page: "operations/tenants",
          subject: "dashboard-counts",
        });
      });
    });

    test.describe("a tenant's staff", () => {
      test("inviting a tenant admin", async ({ page }) => {
        await openScreen(page, locale, MEMBERS_PATH);

        await expectDocsScreenshot(page, {
          element: [
            docsScreenHeader(page),
            docsSection(page, t("platform.tenants.invite_admin_title")),
          ],
          locale,
          page: "operations/tenant-staff",
          subject: "invite-admin",
        });
      });

      test("the invitations, with the role each one grants", async ({
        page,
      }) => {
        await openScreen(page, locale, MEMBERS_PATH);

        await expectDocsScreenshot(page, {
          element: docsSection(page, t("platform.tenants.invitations_title")),
          locale,
          page: "operations/tenant-staff",
          subject: "invitations",
        });
      });

      test("adding an existing user", async ({ page }) => {
        await openScreen(page, locale, MEMBERS_PATH);

        await expectDocsScreenshot(page, {
          element: docsSection(page, t("platform.tenants.add_member")),
          locale,
          page: "operations/tenant-staff",
          subject: "add-member",
        });
      });

      test("the members, with Change role and Remove", async ({ page }) => {
        await openScreen(page, locale, MEMBERS_PATH);

        await expectDocsScreenshot(page, {
          element: docsSection(page, t("platform.tenants.members_list_title")),
          locale,
          page: "operations/tenant-staff",
          subject: "members",
        });
      });
    });

    test.describe("users", () => {
      test("the user list narrowed to one tenant", async ({ page }) => {
        await openScreen(
          page,
          locale,
          `/users?tenant_id=${DOCS_PLATFORM_TENANT.publicId}`
        );

        await expect(
          page.getByText(DOCS_PLATFORM_SUSPENDED_READER.name, { exact: true })
        ).toBeVisible();

        await expectDocsScreenshot(page, {
          element: docsScreen(page),
          locale,
          page: "operations/users",
          subject: "list",
        });
      });

      test("a reader's page", async ({ page }) => {
        await openScreen(
          page,
          locale,
          `/users/${DOCS_PLATFORM_READER.publicId}`
        );

        await expectDocsScreenshot(page, {
          element: docsScreen(page),
          locale,
          page: "operations/users",
          subject: "details",
        });
      });

      test("a suspended reader's page", async ({ page }) => {
        await openScreen(
          page,
          locale,
          `/users/${DOCS_PLATFORM_SUSPENDED_READER.publicId}`
        );

        await expectDocsScreenshot(page, {
          element: docsScreenHeader(page),
          locale,
          page: "operations/users",
          subject: "suspended",
        });
      });
    });
  });
}
