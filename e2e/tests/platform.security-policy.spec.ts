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
 *
 * The reader and API key limits: each is shown as stored, and an operator's
 * new value reaches the column the server charges a reader or a key against.
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

/**
 * Each limit's two labels with the columns they save to, in the order the
 * page shows them. The values raise every built-in one, so that a save moves
 * every column.
 */
const SAVED_LIMITS = [
  {
    column: "legal_page_agreement_limit",
    label: "Terms agreements per reader",
    shorter: 11,
    window: "minute",
  },
  {
    column: "identity_link_limit",
    label: "Account link requests per reader",
    shorter: 6,
    window: "minute",
  },
  {
    column: "icon_change_limit",
    label: "Icon changes per reader",
    shorter: 7,
    window: "minute",
  },
  {
    column: "passkey_limit",
    label: "Passkey actions per reader",
    shorter: 12,
    window: "minute",
  },
  {
    column: "series_remainder_checkout_limit",
    label: "Checkouts of the rest of a series per reader",
    shorter: 13,
    window: "minute",
  },
  {
    column: "subscription_checkout_limit",
    label: "Subscriptions started per reader",
    shorter: 14,
    window: "minute",
  },
  {
    column: "coin_payment_limit",
    label: "Coin payments per reader",
    shorter: 21,
    window: "minute",
  },
  {
    column: "purchase_checkout_limit",
    label: "Purchases started per reader",
    shorter: 15,
    window: "minute",
  },
  {
    column: "promotion_code_attempt_limit",
    label: "Promotion code lookups per reader",
    shorter: 8,
    window: "minute",
  },
  {
    column: "data_export_limit",
    label: "Data download requests per reader",
    shorter: 2,
    window: "hour",
  },
  {
    column: "api_key_request_limit",
    label: "API key requests per key",
    shorter: 1001,
    window: "minute",
  },
] as const;

const LIMIT_COLUMNS = SAVED_LIMITS.flatMap(({ column, window }) => [
  `${column}_per_${window}`,
  `${column}_per_day`,
]);

const limitField = (page: Page, label: string, window: string) =>
  page.getByRole("spinbutton", { name: `${label} per ${window}` });

/** The stored values, in the order of `LIMIT_COLUMNS`. */
const storedLimits = (): string[] =>
  querySql(
    `SELECT concat_ws(',', ${LIMIT_COLUMNS.join(", ")}) FROM platform_policy_config WHERE singleton;`
  ).split(",");

const saveSecurityPolicy = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: "Save security policy" }).click();
};

test.describe.configure({ mode: "serial" });

let limitsBefore: string[];

test.beforeAll(() => {
  applyScenarioSql(PLATFORM_TENANT_COINS_SCENARIO);
  limitsBefore = storedLimits();
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
  querySql(`
    UPDATE platform_policy_config
    SET ${LIMIT_COLUMNS.map(
      (column, index) => `${column} = ${limitsBefore[index]}`
    ).join(", ")},
        revision = revision + 1,
        updated_at = NOW()
    WHERE singleton;
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

test.describe("reader and API key limits on Security", () => {
  test("an operator sees what is stored and saves all of them", async ({
    page,
  }) => {
    await signInAsPlatformOperator(
      page,
      SEED_PLATFORM_SUPER_ADMIN,
      SECURITY_POLICY_PATH
    );

    const stored = storedLimits();

    await Promise.all(
      SAVED_LIMITS.flatMap(({ label, window }, index) => [
        expect(limitField(page, label, window)).toHaveValue(
          String(stored[index * 2])
        ),
        expect(limitField(page, label, "day")).toHaveValue(
          String(stored[index * 2 + 1])
        ),
      ])
    );

    for (const { label, shorter, window } of SAVED_LIMITS) {
      // oxlint-disable-next-line no-await-in-loop -- filling takes the focus, so two at once type into each other
      await limitField(page, label, window).fill(String(shorter));
      // oxlint-disable-next-line no-await-in-loop -- as above
      await limitField(page, label, "day").fill(String(shorter * 100));
    }

    await saveSecurityPolicy(page);
    await expect(formMessage(page)).toContainText("Security policy saved.");

    expect(storedLimits()).toEqual(
      SAVED_LIMITS.flatMap(({ shorter }) => [
        String(shorter),
        String(shorter * 100),
      ])
    );

    await page.reload();

    const [{ label, shorter, window }] = SAVED_LIMITS;
    await expect(limitField(page, label, window)).toHaveValue(String(shorter));
  });
});
