import type { Page } from "@playwright/test";

import type { ConsoleSessions } from "../src/console-sessions";
import { test } from "../src/console-sessions";
import {
  DOCS_LOCALES,
  docsScreenHeader,
  docsSection,
  docsText,
  docsTextPattern,
  expectDocsScreenshot,
  setDocsLocale,
} from "../src/docs-screenshots";
import { SEED_ADMIN } from "../src/scenarios/admin-publish";
import { COMMENT_MODERATION_ADMIN } from "../src/scenarios/comment-moderation";
import {
  CONTACT_WORKFLOW_ADMIN,
  CONTACT_WORKFLOW_IN_PROGRESS,
} from "../src/scenarios/contact-workflow";
import { READER_MFA_CONSOLE_DOCS_READER } from "../src/scenarios/storefront-reader-mfa";
import {
  WEB_ADMIN_BASE_URL,
  WEB_ADMIN_COMMENT_MODERATION_BASE_URL,
  WEB_ADMIN_CONTACT_WORKFLOW_BASE_URL,
} from "../src/urls";

/**
 * The tenant console's Readers group, as the pages under
 * `docs/<locale>/4-console/2-readers/` show it: the reader list and a
 * reader's page, the comment queues, the contact messages, and the access
 * tickets.
 *
 * The seed tenant has readers and a ticket but no comment and no contact
 * message, so those two screens are photographed on the tenants that hold
 * them: the moderation tenant, given a comment in each state by
 * `db/seeds/scenarios/420_docs_comments.sql`, and the help desk tenant of
 * `390_contact_workflow.sql`, whose messages are assigned, annotated, and
 * handled. The reader whose two-step verification is removed is the one
 * `822_docs_console_reader_mfa.sql` keeps it on for, and the confirmation is
 * photographed without being confirmed. Nothing here acts on a reader, a
 * comment, or a message.
 */
test.use({ baseURL: WEB_ADMIN_BASE_URL });

/** The seed tenant's reader, who holds no role on its staff. */
const READER = "SeedMMBRAAA1";

interface Tenant {
  baseUrl: string;
  credentials: { email: string; password: string };
}

const seedTenant: Tenant = {
  baseUrl: WEB_ADMIN_BASE_URL,
  credentials: SEED_ADMIN,
};

/**
 * Sign in to `tenant`'s console as its admin and open `path` in `locale`; the
 * seed tenant's unless another is named.
 */
const openScreen = async (
  page: Page,
  consoleSessions: ConsoleSessions,
  locale: string,
  path: string,
  { baseUrl, credentials }: Tenant = seedTenant
): Promise<void> => {
  await consoleSessions.signIn(page, credentials, baseUrl);
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

  test.describe(`web-admin readers documentation screenshots in ${locale}`, () => {
    test("the reader list, with its search", async ({
      consoleSessions,
      page,
    }) => {
      await openScreen(page, consoleSessions, locale, "/readers");

      await expectDocsScreenshot(page, {
        element: [docsScreenHeader(page), page.getByRole("row").last()],
        locale,
        page: "console/readers/accounts",
        subject: "list",
      });
    });

    test("a reader's page", async ({ consoleSessions, page }) => {
      await openScreen(page, consoleSessions, locale, `/readers/${READER}`);

      await expectDocsScreenshot(page, {
        element: [
          docsScreenHeader(page),
          docsSection(page, t("admin.readers.account_title")),
        ],
        locale,
        page: "console/readers/accounts",
        subject: "reader",
      });
    });

    test("the confirmation that removes a reader's two-step verification", async ({
      consoleSessions,
      page,
    }) => {
      await openScreen(
        page,
        consoleSessions,
        locale,
        `/readers/${READER_MFA_CONSOLE_DOCS_READER.publicId}`
      );

      await page
        .getByRole("button", {
          exact: true,
          name: t("admin.readers.mfa_remove"),
        })
        .click();

      await expectDocsScreenshot(page, {
        element: page.getByRole("alertdialog"),
        locale,
        page: "console/readers/accounts",
        subject: "two-step-remove",
      });
    });

    test("the reported comments", async ({ consoleSessions, page }) => {
      await openScreen(
        page,
        consoleSessions,
        locale,
        "/comments",
        moderationTenant
      );

      await expectDocsScreenshot(page, {
        element: [
          docsScreenHeader(page),
          docsSection(page, t("admin.comments.reports.title")),
        ],
        locale,
        page: "console/readers/comments",
        subject: "reports",
      });
    });

    test("the comment list, with a comment in each state", async ({
      consoleSessions,
      page,
    }) => {
      await openScreen(
        page,
        consoleSessions,
        locale,
        "/comments",
        moderationTenant
      );

      await expectDocsScreenshot(page, {
        element: [
          page.getByText(
            docsTextPattern(locale, "admin.comments.filter.description")
          ),
          docsSection(page, t("admin.comments.list_title")),
        ],
        locale,
        page: "console/readers/comments",
        subject: "list",
      });
    });

    test("the contact messages", async ({ consoleSessions, page }) => {
      await openScreen(
        page,
        consoleSessions,
        locale,
        "/contact-messages",
        helpDeskTenant
      );

      await expectDocsScreenshot(page, {
        element: [docsScreenHeader(page), page.getByRole("row").last()],
        locale,
        page: "console/readers/contact-messages",
        subject: "list",
      });
    });

    test("a contact message, assigned and annotated", async ({
      consoleSessions,
      page,
    }) => {
      await openScreen(
        page,
        consoleSessions,
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
        page: "console/readers/contact-messages",
        subject: "message",
      });
    });

    test("the access tickets", async ({ consoleSessions, page }) => {
      await openScreen(page, consoleSessions, locale, "/access-tickets");

      await expectDocsScreenshot(page, {
        element: [docsScreenHeader(page), page.getByRole("row").last()],
        locale,
        page: "console/readers/access-tickets",
        subject: "list",
      });
    });

    test("the form that issues a ticket", async ({ consoleSessions, page }) => {
      await openScreen(page, consoleSessions, locale, "/access-tickets/new");

      await expectDocsScreenshot(page, {
        element: [
          docsScreenHeader(page),
          page.getByRole("button", {
            name: t("admin.access_tickets.form.submit"),
          }),
        ],
        locale,
        page: "console/readers/access-tickets",
        subject: "issue-form",
      });
    });
  });
}
