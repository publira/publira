import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql } from "../src/db";
import {
  LEGAL_PAGE_AGREEMENT_ADMIN,
  LEGAL_PAGE_AGREEMENT_PRIVACY_PAGE,
  LEGAL_PAGE_AGREEMENT_READER,
  LEGAL_PAGE_AGREEMENT_SCENARIO,
  LEGAL_PAGE_AGREEMENT_TENANT,
  LEGAL_PAGE_AGREEMENT_TERMS_PAGE,
} from "../src/scenarios/legal-page-agreement";
import { signInAsMember } from "../src/storefront";
import {
  storefrontPath,
  WEB_ADMIN_LEGAL_PAGE_AGREEMENT_BASE_URL,
  WEB_STOREFRONT_LEGAL_PAGE_AGREEMENT_BASE_URL,
} from "../src/urls";

/**
 * A Tenant admin publishes a revision of the terms of service asking every
 * reader to agree to it. A reader who agreed to the earlier version is sent to
 * agree on the next page they open, may still read the page they are asked
 * about, and is returned where they were once they agree, after which the site
 * does not ask again.
 */

const storefrontUrl = (pathname: string): string =>
  `${WEB_STOREFRONT_LEGAL_PAGE_AGREEMENT_BASE_URL}${storefrontPath(pathname)}`;

const CONSENT_LABEL = "I have read and agree to the following.";
const AGREEMENT_DESCRIPTION =
  "The pages below have been updated. Read them and agree to them to keep using your account.";

/** The agreement screen, carrying `returnTo`, which holds no character a pattern reads. */
const agreementUrl = (returnTo: string): RegExp =>
  new RegExp(
    `/settings/agreement\\?returnTo=${encodeURIComponent(returnTo)}$`,
    "u"
  );

const versionRow = (page: Page, versionNumber: number): Locator =>
  page.getByRole("row").filter({
    has: page.getByRole("cell", { exact: true, name: `v${versionNumber}` }),
  });

const readerAgreedToRevision = (): string =>
  querySql(`
    SELECT count(*)
    FROM user_page_consents c
    JOIN users u ON u.id = c.user_id
    JOIN tenants t ON t.id = u.tenant_id
    WHERE t.public_id = '${LEGAL_PAGE_AGREEMENT_TENANT}'
      AND u.email = '${LEGAL_PAGE_AGREEMENT_READER.email}'
      AND c.page_version_id = '${LEGAL_PAGE_AGREEMENT_TERMS_PAGE.revisedVersionId}';
  `);

// The reader's agreement is one record the later tests read, so the suite runs
// in order and resets itself around either outcome.
test.describe.configure({ mode: "serial" });

test.describe("web-storefront agreement to revised terms", () => {
  test.beforeAll(() => {
    applyScenarioSql(LEGAL_PAGE_AGREEMENT_SCENARIO);
  });

  test.afterAll(() => {
    applyScenarioSql(LEGAL_PAGE_AGREEMENT_SCENARIO);
  });

  test("the console publishes the revision asking readers to agree to it", async ({
    page,
  }) => {
    const pagePath = `/pages/${LEGAL_PAGE_AGREEMENT_TERMS_PAGE.id}`;
    await signInAsAdmin(
      page,
      LEGAL_PAGE_AGREEMENT_ADMIN,
      pagePath,
      WEB_ADMIN_LEGAL_PAGE_AGREEMENT_BASE_URL
    );

    await versionRow(page, 2).getByRole("button", { name: "Publish" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("Publish v2")).toBeVisible();
    await dialog
      .getByRole("button", { name: "Publish and ask readers to agree" })
      .click();

    await expect(
      versionRow(page, 2).getByText("Readers asked to agree", { exact: true })
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      versionRow(page, 2).getByText("Published", { exact: true })
    ).toBeVisible();
  });

  test("a reader who agreed to the earlier version is asked on the next page they open", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      LEGAL_PAGE_AGREEMENT_READER,
      "/my",
      WEB_STOREFRONT_LEGAL_PAGE_AGREEMENT_BASE_URL
    );

    await expect(page).toHaveURL(agreementUrl("/my"));
    await expect(page.getByText(AGREEMENT_DESCRIPTION)).toBeVisible();
    // Only the page that changed is asked about.
    await expect(
      page.getByRole("link", { name: LEGAL_PAGE_AGREEMENT_TERMS_PAGE.title })
    ).toHaveAttribute("href", LEGAL_PAGE_AGREEMENT_TERMS_PAGE.path);
    await expect(
      page
        .getByRole("main")
        .getByRole("link", { name: LEGAL_PAGE_AGREEMENT_PRIVACY_PAGE.title })
    ).toHaveCount(0);

    // The page the reader is asked about stays open to them.
    await page.goto(storefrontUrl(LEGAL_PAGE_AGREEMENT_TERMS_PAGE.path));
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: LEGAL_PAGE_AGREEMENT_TERMS_PAGE.title,
      })
    ).toBeVisible();
    await expect(page).toHaveURL(
      storefrontUrl(LEGAL_PAGE_AGREEMENT_TERMS_PAGE.path)
    );

    // Any other page sends them back to agree, remembering where they were.
    await page.goto(storefrontUrl("/series"));
    await expect(page).toHaveURL(agreementUrl("/series"));
    expect(readerAgreedToRevision()).toBe("0");
  });

  test("agreeing returns the reader where they were, and the site does not ask again", async ({
    page,
  }) => {
    await signInAsMember(
      page,
      LEGAL_PAGE_AGREEMENT_READER,
      "/my",
      WEB_STOREFRONT_LEGAL_PAGE_AGREEMENT_BASE_URL
    );
    await expect(page).toHaveURL(agreementUrl("/my"));

    await page.getByRole("checkbox", { name: CONSENT_LABEL }).check();
    await page.getByRole("button", { name: "Agree and continue" }).click();

    await expect(page).toHaveURL(storefrontUrl("/my"));
    expect(readerAgreedToRevision()).toBe("1");

    await page.goto(storefrontUrl("/series"));
    await expect(page).toHaveURL(storefrontUrl("/series"));
    await page.goto(storefrontUrl("/my"));
    await expect(page).toHaveURL(storefrontUrl("/my"));
  });
});
