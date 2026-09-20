import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { fillField, signInAsAdmin } from "../src/admin";
import { applyScenarioSql, querySql } from "../src/db";
import {
  TENANT_POLICY_ADMIN,
  TENANT_POLICY_SCENARIO,
  TENANT_POLICY_TENANT,
} from "../src/scenarios/tenant-policy";
import { WEB_ADMIN_TENANT_POLICY_BASE_URL } from "../src/urls";

/**
 * A tenant administrator setting the two policies their own tenant answers for:
 * how long its records are kept, and how often its readers may act.
 */

const POLICY_PATH = "/settings/policy";

const RETENTION_SAVED = "The retention periods were saved.";
const COMMUNITY_SAVED = "The community limits were saved.";
const TOO_LOOSE = "Comment posting may not be looser than the platform limit.";

const signIn = (page: Page): Promise<void> =>
  signInAsAdmin(
    page,
    TENANT_POLICY_ADMIN,
    POLICY_PATH,
    WEB_ADMIN_TENANT_POLICY_BASE_URL
  );

const openPolicySettings = async (page: Page): Promise<void> => {
  await page.goto(`${WEB_ADMIN_TENANT_POLICY_BASE_URL}${POLICY_PATH}`);
  await expect(
    page.getByRole("button", { name: "Save the retention periods" })
  ).toBeVisible();
};

/** One override group, by the heading its `<legend>` gives it. */
const group = (page: Page, legend: string): Locator =>
  page.getByRole("group", { exact: true, name: legend });

const usePlatformDefault = (fieldset: Locator): Locator =>
  fieldset.getByRole("checkbox", { name: "Use the platform default" });

// A scalar subquery, so a tenant with no row at all still answers `none`.
const savedWithdrawnCommentDays = (): string =>
  querySql(`
    SELECT COALESCE((
      SELECT withdrawn_comment_days::text
      FROM tenant_retention_settings
      WHERE tenant_id = (
        SELECT id FROM tenants
        WHERE public_id = '${TENANT_POLICY_TENANT.publicId}'
      )
    ), 'none');
  `);

const savedCommentPostPerDay = (): string =>
  querySql(`
    SELECT COALESCE((
      SELECT comment_post_limit_per_day::text
      FROM tenant_community_limit_overrides
      WHERE tenant_id = (
        SELECT id FROM tenants
        WHERE public_id = '${TENANT_POLICY_TENANT.publicId}'
      )
    ), 'none');
  `);

test.beforeAll(() => {
  applyScenarioSql(TENANT_POLICY_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(TENANT_POLICY_SCENARIO);
});

test.describe("tenant policy settings", () => {
  test("saves a retention period and reads it back as the tenant's own", async ({
    page,
  }) => {
    await signIn(page);
    await openPolicySettings(page);

    const withdrawn = group(page, "Withdrawn comments");

    // The scenario left nothing saved, so this period follows the platform.
    await expect(usePlatformDefault(withdrawn)).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(
      withdrawn.getByText("Platform default: 180 days")
    ).toBeVisible();

    await usePlatformDefault(withdrawn).click();
    await fillField(
      withdrawn.getByRole("spinbutton", { name: "Days kept" }),
      "30"
    );
    await page
      .getByRole("button", { name: "Save the retention periods" })
      .click();
    await expect(page.getByText(RETENTION_SAVED)).toBeVisible();

    expect(savedWithdrawnCommentDays()).toBe("30");

    await openPolicySettings(page);

    const saved = group(page, "Withdrawn comments");
    await expect(usePlatformDefault(saved)).toHaveAttribute(
      "aria-checked",
      "false"
    );
    await expect(
      saved.getByRole("spinbutton", { name: "Days kept" })
    ).toHaveValue("30");
  });

  // Runs on the period the test above saved: returning to the default is what
  // the tenant does to the value they already chose.
  test("returns a retention period to the platform default", async ({
    page,
  }) => {
    await signIn(page);
    await openPolicySettings(page);

    const withdrawn = group(page, "Withdrawn comments");
    await expect(usePlatformDefault(withdrawn)).toHaveAttribute(
      "aria-checked",
      "false"
    );

    await usePlatformDefault(withdrawn).click();
    await page
      .getByRole("button", { name: "Save the retention periods" })
      .click();
    await expect(page.getByText(RETENTION_SAVED)).toBeVisible();

    expect(savedWithdrawnCommentDays()).toBe("none");

    await openPolicySettings(page);
    await expect(
      usePlatformDefault(group(page, "Withdrawn comments"))
    ).toHaveAttribute("aria-checked", "true");
  });

  // The tenant may only tighten, so the console names the row it refused.
  // Nothing is saved, which leaves the limit at the platform value below.
  test("refuses a community limit looser than the platform value", async ({
    page,
  }) => {
    await signIn(page);
    await openPolicySettings(page);

    const commentPost = group(page, "Comment posting");
    const perDay = commentPost.getByRole("spinbutton", {
      name: "Comment posts per day",
    });
    const platformPerDay = Number(await perDay.inputValue());

    await usePlatformDefault(commentPost).click();
    await fillField(perDay, String(platformPerDay + 1));
    await page
      .getByRole("button", { name: "Save the community limits" })
      .click();

    await expect(page.getByText(TOO_LOOSE, { exact: false })).toBeVisible();
    expect(savedCommentPostPerDay()).toBe("none");

    // The entry survives the refusal, so it can be corrected in place.
    await expect(perDay).toHaveValue(String(platformPerDay + 1));
  });

  test("saves a community limit stricter than the platform value", async ({
    page,
  }) => {
    await signIn(page);
    await openPolicySettings(page);

    const commentPost = group(page, "Comment posting");
    await expect(usePlatformDefault(commentPost)).toHaveAttribute(
      "aria-checked",
      "true"
    );

    await usePlatformDefault(commentPost).click();
    await fillField(
      commentPost.getByRole("spinbutton", { name: "Comment posts per minute" }),
      "1"
    );
    await fillField(
      commentPost.getByRole("spinbutton", { name: "Comment posts per day" }),
      "5"
    );
    await page
      .getByRole("button", { name: "Save the community limits" })
      .click();
    await expect(page.getByText(COMMUNITY_SAVED)).toBeVisible();

    expect(savedCommentPostPerDay()).toBe("5");

    await openPolicySettings(page);

    const saved = group(page, "Comment posting");
    await expect(usePlatformDefault(saved)).toHaveAttribute(
      "aria-checked",
      "false"
    );
    await expect(
      saved.getByRole("spinbutton", { name: "Comment posts per day" })
    ).toHaveValue("5");
  });
});
