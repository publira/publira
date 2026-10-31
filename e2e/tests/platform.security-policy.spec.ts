import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql, querySql } from "../src/db";
import { formMessage, signInAsPlatformOperator } from "../src/platform";
import {
  PLATFORM_TENANT_COINS_AUDITOR,
  PLATFORM_TENANT_COINS_OPERATOR,
  PLATFORM_TENANT_COINS_SCENARIO,
} from "../src/scenarios/platform-tenant-coins";
import { SEED_PLATFORM_SUPER_ADMIN } from "../src/scenarios/platform-tenants";

/**
 * Saves of the Platform Console's **Security** page. The page saves the whole
 * policy row against the revision it was rendered at, so its suites run one
 * after another here rather than beside one another, where each would refuse
 * the other's save as stale.
 *
 * The platform's allowance for tenant-issued coins: an Operator turns it on
 * and off, and an Auditor sees the same checkbox and has the save refused.
 *
 * The anonymous read limits: an operator raises one and the server stores
 * it, and a value below what the edge admits is not submitted.
 */

const SECURITY_POLICY_PATH = "/policies/security";

const ALLOW_TENANT_COINS = "Allow tenants to issue coins";

const allowanceCheckbox = (page: Page) =>
  page.getByRole("checkbox", { exact: true, name: ALLOW_TENANT_COINS });

const storedAllowance = (): string =>
  querySql(
    "SELECT tenant_coins_allowed::text FROM platform_policy_config WHERE singleton;"
  );

/**
 * The policy saves recorded for the suite's Operator. Counted per actor
 * because nothing in the suite deletes `platform_audit_logs`, so earlier runs
 * leave rows of the same action behind.
 */
const policySavesByOperator = (): number =>
  Number(
    querySql(`
      SELECT COUNT(*)::text
      FROM platform_audit_logs l
      JOIN platform_users pu ON pu.id = l.actor_platform_user_id
      WHERE pu.public_id = '${PLATFORM_TENANT_COINS_OPERATOR.publicId}'
        AND l.action = 'platform_policy_updated'
        AND l.outcome = 'success';
    `)
  );

const PUBLIC_API_READS = "Public API calls per client per 10 seconds";

const publicApiReadsField = (page: Page) =>
  page.getByRole("spinbutton", { name: PUBLIC_API_READS });

/** The limit `publira server` charges a client's public API calls against. */
const storedPublicApiReads = (): string =>
  querySql(
    "SELECT anonymous_read_public_api_limit_per_10_seconds::text FROM platform_policy_config WHERE singleton;"
  );

const saveSecurityPolicy = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Save security policy" }).click();
};

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  applyScenarioSql(PLATFORM_TENANT_COINS_SCENARIO);
});

test.afterAll(() => {
  applyScenarioSql(PLATFORM_TENANT_COINS_SCENARIO);
  // Back to the built-in value, which every other suite reads behind.
  querySql(`
    UPDATE platform_policy_config
    SET anonymous_read_public_api_limit_per_10_seconds = 640,
        revision = revision + 1,
        updated_at = NOW()
    WHERE singleton
      AND anonymous_read_public_api_limit_per_10_seconds <> 640;
  `);
});

test.describe("tenant coin allowance on Security", () => {
  test("an Operator turns the allowance on and off, and each save is audited", async ({
    page,
  }) => {
    await signInAsPlatformOperator(
      page,
      PLATFORM_TENANT_COINS_OPERATOR,
      SECURITY_POLICY_PATH
    );
    await expect(allowanceCheckbox(page)).not.toBeChecked();
    const savesBefore = policySavesByOperator();

    await allowanceCheckbox(page).setChecked(true);
    await saveSecurityPolicy(page);
    await expect(formMessage(page)).toContainText("Security policy saved.");

    // The page reads back what was stored, not the form it submitted.
    await page.reload();
    await expect(allowanceCheckbox(page)).toBeChecked();
    expect(storedAllowance()).toBe("true");

    await allowanceCheckbox(page).setChecked(false);
    await saveSecurityPolicy(page);
    await expect(formMessage(page)).toContainText("Security policy saved.");

    await page.reload();
    await expect(allowanceCheckbox(page)).not.toBeChecked();
    expect(storedAllowance()).toBe("false");
    expect(policySavesByOperator()).toBe(savesBefore + 2);
  });

  test("an Auditor sees the allowance and has the save refused", async ({
    page,
  }) => {
    await signInAsPlatformOperator(
      page,
      PLATFORM_TENANT_COINS_AUDITOR,
      SECURITY_POLICY_PATH
    );
    await expect(allowanceCheckbox(page)).not.toBeChecked();

    await allowanceCheckbox(page).setChecked(true);
    await saveSecurityPolicy(page);
    await expect(formMessage(page)).toContainText(
      "You do not have permission to perform this action."
    );

    expect(storedAllowance()).toBe("false");
  });
});

test.describe("anonymous read limits on Security", () => {
  test("an operator raises a read limit, and the server stores what was saved", async ({
    page,
  }) => {
    await signInAsPlatformOperator(
      page,
      SEED_PLATFORM_SUPER_ADMIN,
      SECURITY_POLICY_PATH
    );
    await expect(publicApiReadsField(page)).toHaveValue(storedPublicApiReads());

    await publicApiReadsField(page).fill("700");
    await saveSecurityPolicy(page);
    await expect(formMessage(page)).toContainText("Security policy saved.");

    await page.reload();
    await expect(publicApiReadsField(page)).toHaveValue("700");
    expect(storedPublicApiReads()).toBe("700");
  });

  // 320 is what the sample edge configurations admit from one client in 10
  // seconds, the least the server accepts.
  test("a value below what the edge admits is not submitted", async ({
    page,
  }) => {
    await signInAsPlatformOperator(
      page,
      SEED_PLATFORM_SUPER_ADMIN,
      SECURITY_POLICY_PATH
    );
    const stored = storedPublicApiReads();

    await publicApiReadsField(page).fill("319");
    await saveSecurityPolicy(page);

    expect(
      await publicApiReadsField(page).evaluate(
        (input: HTMLInputElement) => input.validity.rangeUnderflow
      )
    ).toBe(true);
    expect(storedPublicApiReads()).toBe(stored);
  });
});
