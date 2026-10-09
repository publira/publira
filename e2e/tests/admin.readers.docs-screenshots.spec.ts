import type { Page } from "@playwright/test";
import { test } from "@playwright/test";

import { signInAsAdmin, signInAsSeedAdmin } from "../src/admin";
import {
  DOCS_LOCALES,
  docsScreenHeader,
  docsSection,
  docsText,
  docsTextPattern,
  expectDocsScreenshot,
  setDocsLocale,
} from "../src/docs-screenshots";
import { COMMENT_MODERATION_ADMIN } from "../src/scenarios/comment-moderation";
import {
  CONTACT_WORKFLOW_ADMIN,
  CONTACT_WORKFLOW_IN_PROGRESS,
} from "../src/scenarios/contact-workflow";
import {
  WEB_ADMIN_BASE_URL,
  WEB_ADMIN_COMMENT_MODERATION_BASE_URL,
  WEB_ADMIN_CONTACT_WORKFLOW_BASE_URL,
} from "../src/urls";

/**
 * The tenant console's Readers group, as
 * `docs/<locale>/4-console/2-readers.md` shows it: the reader list and a
 * reader's page, the comment queues, the contact messages, and the access
 * tickets.
 *
 * The seed tenant has readers and a ticket but no comment and no contact
 * message, so those two screens are photographed on the tenants that hold
 * them: the moderation tenant, given a comment in each state by
 * `db/seeds/scenarios/420_docs_comments.sql`, and the help desk tenant of
 * `390_contact_workflow.sql`, whose messages are assigned, annotated, and
 * handled. Nothing here acts on a reader, a comment, or a message.
 */
test.use({ baseURL: WEB_ADMIN_BASE_URL });

/** The seed tenant's reader, who holds no role on its staff. */
const READER = "SeedMMBRAAA1";

/**
 * Sign in to the console at `baseUrl` and open `path` in `locale`; the seed
 * tenant's admin unless `credentials` name another tenant's.
 */
const openScreen = async (
  page: Page,
  locale: string,
  path: string,
  tenant?: {
    baseUrl: string;
    credentials: { email: string; password: string };
  }
): Promise<void> => {
  await (tenant
    ? signInAsAdmin(page, tenant.credentials, path, tenant.baseUrl)
    : signInAsSeedAdmin(page, path));
  const baseUrl = tenant?.baseUrl ?? WEB_ADMIN_BASE_URL;
  await setDocsLocale(page, baseUrl, locale);
  await page.goto(`${baseUrl}${path}`);
};

const moderationTenant = {
  baseUrl: WEB_ADMIN_COMMENT_MODERATION_BASE_URL,
  credentials: COMMENT_MODERATION_ADMIN,
};

const helpDeskTenant = {
  baseUrl: WEB_ADMIN_CONTACT_WORKFLOW_BASE_URL,
  credentials: CONTACT_WORKFLOW_ADMIN,
};

for (const locale of DOCS_LOCALES) {
  const t = (key: string): string => docsText(locale, key);
  const readersPage = "console/readers";

  test.describe(`web-admin readers documentation screenshots in ${locale}`, () => {
    test("the reader list, with its search", async ({ page }) => {
      await openScreen(page, locale, "/readers");

      await expectDocsScreenshot(page, {
        element: [docsScreenHeader(page), page.getByRole("row").last()],
        locale,
        page: readersPage,
        subject: "list",
      });
    });

    test("a reader's page", async ({ page }) => {
      await openScreen(page, locale, `/readers/${READER}`);

      await expectDocsScreenshot(page, {
        element: [
          docsScreenHeader(page),
          docsSection(page, t("admin.readers.account_title")),
        ],
        locale,
        page: readersPage,
        subject: "reader",
      });
    });

    test("the reported comments", async ({ page }) => {
      await openScreen(page, locale, "/comments", moderationTenant);

      await expectDocsScreenshot(page, {
        element: [
          docsScreenHeader(page),
          docsSection(page, t("admin.comments.reports.title")),
        ],
        locale,
        page: readersPage,
        subject: "reported-comments",
      });
    });

    test("the comment list, with a comment in each state", async ({ page }) => {
      await openScreen(page, locale, "/comments", moderationTenant);

      await expectDocsScreenshot(page, {
        element: [
          page.getByText(
            docsTextPattern(locale, "admin.comments.filter.description")
          ),
          docsSection(page, t("admin.comments.list_title")),
        ],
        locale,
        page: readersPage,
        subject: "comments",
      });
    });

    test("the contact messages", async ({ page }) => {
      await openScreen(page, locale, "/contact-messages", helpDeskTenant);

      await expectDocsScreenshot(page, {
        element: [docsScreenHeader(page), page.getByRole("row").last()],
        locale,
        page: readersPage,
        subject: "contact-messages",
      });
    });

    test("a contact message, assigned and annotated", async ({ page }) => {
      await openScreen(
        page,
        locale,
        `/contact-messages/${CONTACT_WORKFLOW_IN_PROGRESS.publicId}`,
        helpDeskTenant
      );

      await expectDocsScreenshot(page, {
        element: [
          docsScreenHeader(page),
          page.getByRole("main").locator("section").last(),
        ],
        locale,
        page: readersPage,
        subject: "contact-message",
      });
    });

    test("the access tickets", async ({ page }) => {
      await openScreen(page, locale, "/access-tickets");

      await expectDocsScreenshot(page, {
        element: [docsScreenHeader(page), page.getByRole("row").last()],
        locale,
        page: readersPage,
        subject: "access-tickets",
      });
    });

    test("the form that issues a ticket", async ({ page }) => {
      await openScreen(page, locale, "/access-tickets/new");

      await expectDocsScreenshot(page, {
        element: [
          docsScreenHeader(page),
          page.getByRole("button", {
            name: t("admin.access_tickets.form.submit"),
          }),
        ],
        locale,
        page: readersPage,
        subject: "issue-ticket",
      });
    });
  });
}
