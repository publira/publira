import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql, querySql, runSql } from "../src/db";
import {
  SIGNUP_CONSENT_PRIVACY_PAGE,
  SIGNUP_CONSENT_READER,
  SIGNUP_CONSENT_SCENARIO,
  SIGNUP_CONSENT_SHARED_PAGE,
  SIGNUP_CONSENT_SHARED_TENANT,
  SIGNUP_CONSENT_TENANT,
  SIGNUP_CONSENT_TERMS_PAGE,
} from "../src/scenarios/signup-consent";
import {
  hostPath,
  WEB_HOST_BASE_URL,
  WEB_HOST_SIGNUP_CONSENT_BASE_URL,
  WEB_HOST_SIGNUP_SHARED_CONSENT_BASE_URL,
} from "../src/urls";

/**
 * A tenant that names its terms of service and privacy policy asks a reader to
 * agree to both before an account is opened, and the account records the
 * version of each page the form linked to. A page named for both roles is
 * agreed to once. A tenant that names neither keeps the form it had. A page
 * republished while the form is open is agreed to again before the account is
 * opened.
 */

const signupUrl = `${WEB_HOST_SIGNUP_CONSENT_BASE_URL}${hostPath("/signup")}`;
const sharedSignupUrl = `${WEB_HOST_SIGNUP_SHARED_CONSENT_BASE_URL}${hostPath("/signup")}`;

const CONSENT_LABEL = "I have read and agree to the following.";
const CONSENT_CHANGED_MESSAGE =
  "The pages to agree to have been updated. Read them and agree again.";
const SIGNUP_SENT_MESSAGE =
  "We sent an email to the address you entered. Open it to continue.";

const consentCheckbox = (page: Page) =>
  page.getByRole("checkbox", { name: CONSENT_LABEL });

const fillSignupForm = async (page: Page): Promise<void> => {
  await page.getByLabel("Name").fill(SIGNUP_CONSENT_READER.name);
  await page.getByLabel("Email address").fill(SIGNUP_CONSENT_READER.email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(SIGNUP_CONSENT_READER.password);
  await page
    .getByLabel("Confirm password")
    .fill(SIGNUP_CONSENT_READER.password);
};

const accountCount = (tenantPublicId: string = SIGNUP_CONSENT_TENANT): string =>
  querySql(`
    SELECT count(*)
    FROM users u
    JOIN tenants t ON t.id = u.tenant_id
    WHERE t.public_id = '${tenantPublicId}'
      AND u.email = '${SIGNUP_CONSENT_READER.email}';
  `);

const agreedVersionIds = (
  tenantPublicId: string = SIGNUP_CONSENT_TENANT
): string[] =>
  querySql(`
    SELECT c.page_version_id
    FROM user_page_consents c
    JOIN users u ON u.id = c.user_id
    JOIN tenants t ON t.id = u.tenant_id
    WHERE t.public_id = '${tenantPublicId}'
      AND u.email = '${SIGNUP_CONSENT_READER.email}'
    ORDER BY c.page_version_id;
  `)
    .split("\n")
    .filter((line) => line.length > 0);

/**
 * A third version of the terms page, published straight into the database the
 * way the console publishes one. No cache revalidation follows, so the form
 * can only learn of it from the submission.
 */
const REPUBLISHED_TERMS_VERSION_ID = "018f0ff0-0003-7000-8000-000000000005";

const republishTermsPage = (): void => {
  runSql(`
    INSERT INTO page_versions (
        id, page_id, tenant_id, version_number, content_markdown, status,
        published_at
    )
    SELECT
        '${REPUBLISHED_TERMS_VERSION_ID}', p.id, p.tenant_id, 3,
        'The terms of service, revised again.', 'published', NOW()
    FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
    WHERE t.public_id = '${SIGNUP_CONSENT_TENANT}'
      AND p.slug = '${SIGNUP_CONSENT_TERMS_PAGE.path}';

    UPDATE pages p
    SET published_version_id = '${REPUBLISHED_TERMS_VERSION_ID}'
    FROM tenants t
    WHERE t.id = p.tenant_id
      AND t.public_id = '${SIGNUP_CONSENT_TENANT}'
      AND p.slug = '${SIGNUP_CONSENT_TERMS_PAGE.path}';
  `);
};

// The sign-up creates the account the next test would collide with, so the
// suite runs in order and resets itself around either outcome.
test.describe.configure({ mode: "serial" });

test.describe("web-host sign-up consent", () => {
  test.beforeAll(() => {
    applyScenarioSql(SIGNUP_CONSENT_SCENARIO);
  });

  test.afterAll(() => {
    applyScenarioSql(SIGNUP_CONSENT_SCENARIO);
  });

  test("the form links to each page the tenant names", async ({ page }) => {
    await page.goto(signupUrl);

    await expect(consentCheckbox(page)).not.toBeChecked();
    await expect(
      page.getByRole("link", { name: SIGNUP_CONSENT_TERMS_PAGE.title })
    ).toHaveAttribute("href", SIGNUP_CONSENT_TERMS_PAGE.path);
    await expect(
      page.getByRole("link", { name: SIGNUP_CONSENT_PRIVACY_PAGE.title })
    ).toHaveAttribute("href", SIGNUP_CONSENT_PRIVACY_PAGE.path);
  });

  test("a sign-up without consent is refused by the form", async ({ page }) => {
    await page.goto(signupUrl);
    await fillSignupForm(page);

    const form = page.locator("form").filter({ has: consentCheckbox(page) });
    await expect
      .poll(() =>
        form.evaluate((node: HTMLFormElement) => node.checkValidity())
      )
      .toBe(false);
    await page.getByRole("button", { name: "Sign up" }).click();

    await expect(page.getByText(SIGNUP_SENT_MESSAGE)).toBeHidden();
    await expect(page).toHaveURL(signupUrl);
    expect(accountCount()).toBe("0");
  });

  test("a sign-up with consent opens an account carrying the versions it agreed to", async ({
    page,
  }) => {
    await page.goto(signupUrl);
    await fillSignupForm(page);
    await consentCheckbox(page).check();
    await page.getByRole("button", { name: "Sign up" }).click();

    await expect(page.getByText(SIGNUP_SENT_MESSAGE)).toBeVisible();
    expect(accountCount()).toBe("1");
    expect(agreedVersionIds()).toEqual([
      SIGNUP_CONSENT_TERMS_PAGE.versionId,
      SIGNUP_CONSENT_PRIVACY_PAGE.versionId,
    ]);
  });

  test("a page named for both roles is agreed to once", async ({ page }) => {
    await page.goto(sharedSignupUrl);

    await expect(
      page.getByRole("link", { name: SIGNUP_CONSENT_SHARED_PAGE.title })
    ).toHaveCount(1);

    await fillSignupForm(page);
    await consentCheckbox(page).check();
    await page.getByRole("button", { name: "Sign up" }).click();

    await expect(page.getByText(SIGNUP_SENT_MESSAGE)).toBeVisible();
    expect(accountCount(SIGNUP_CONSENT_SHARED_TENANT)).toBe("1");
    expect(agreedVersionIds(SIGNUP_CONSENT_SHARED_TENANT)).toEqual([
      SIGNUP_CONSENT_SHARED_PAGE.versionId,
    ]);
  });

  test("a page republished after the form rendered is agreed to again", async ({
    page,
  }) => {
    // Starts from the scenario rather than the account an earlier test opened.
    applyScenarioSql(SIGNUP_CONSENT_SCENARIO);
    await page.goto(signupUrl);
    await fillSignupForm(page);
    await consentCheckbox(page).check();

    republishTermsPage();
    await page.getByRole("button", { name: "Sign up" }).click();

    await expect(page.getByText(CONSENT_CHANGED_MESSAGE)).toBeVisible();
    await expect(consentCheckbox(page)).not.toBeChecked();
    expect(accountCount()).toBe("0");
    await expect(page.getByLabel("Name")).toHaveValue(
      SIGNUP_CONSENT_READER.name
    );
    await expect(page.getByLabel("Email address")).toHaveValue(
      SIGNUP_CONSENT_READER.email
    );

    await consentCheckbox(page).check();
    await page.getByRole("button", { name: "Sign up" }).click();

    await expect(page.getByText(SIGNUP_SENT_MESSAGE)).toBeVisible();
    expect(agreedVersionIds()).toEqual([
      SIGNUP_CONSENT_PRIVACY_PAGE.versionId,
      REPUBLISHED_TERMS_VERSION_ID,
    ]);
  });

  test("a tenant that names no page asks for no consent", async ({ page }) => {
    await page.goto(`${WEB_HOST_BASE_URL}${hostPath("/signup")}`);

    await expect(page.getByLabel("Confirm password")).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });
});
