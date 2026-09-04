import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  applyScenarioSql,
  deletePlatformOperatorsByEmails,
  querySql,
} from "../src/db";
import {
  confirmDangerAction,
  createOperatorViaUi,
  formMessage,
  signInAsPlatformOperator,
  signInAsSeedPlatformSuperAdmin,
  signOutPlatform,
} from "../src/platform";
import { SEED_ADMIN } from "../src/scenarios/admin-publish";
import { SEED_MEMBER_PUBLIC_ID } from "../src/scenarios/auth";
import { SEED_MEMBER } from "../src/scenarios/member-announcements";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import {
  NOTIFICATION_INBOX_MEMBER,
  NOTIFICATION_INBOX_SCENARIO,
  NOTIFICATION_INBOX_TENANT,
} from "../src/scenarios/notification-inbox";
import {
  PLATFORM_OPERATORS_SCENARIO,
  SCENARIO_DEACTIVATED_OPERATOR,
  SCENARIO_ROLE_CHANGE_OPERATOR,
  uniqueSuffix,
} from "../src/scenarios/platform-tenants";
import { fillLoginForm, LOGIN_FAILED_MESSAGE } from "../src/session";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

const platformUrl = (pathname: string): string =>
  `${WEB_PLATFORM_BASE_URL}${pathname}`;

/**
 * The role form on an operator detail screen, found by its own save button: it
 * is the only form there, and the select inside is a Base UI trigger rather than
 * a native `<select>`, so the role currently saved is read off that trigger.
 */
const roleForm = (page: Page): Locator =>
  page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "保存" }) });

const listRow = (page: Page, text: string): Locator =>
  page.locator("tr", { hasText: text });

/**
 * The same locator with the screen the console navigated away from left out.
 *
 * A click on a list's detail link is a client navigation, and the router keeps
 * the list mounted in its bfcache, so both screens' markup is in the document at
 * once. Every value asserted on a detail screen reached that way needs this.
 */
const onlyVisible = (locator: Locator): Locator =>
  locator.filter({ visible: true });

/** The three role labels, which are the only values `現在のロール` can hold. */
const ROLE_LABELS = /^(?:オペレーター|スーパー管理者|監査担当)$/u;

/**
 * The `現在のロール` value on an operator detail screen.
 *
 * Saving a role shows no confirmation, because `ActionForm` renders the message
 * the Action returns only for a caller that passes `showSuccess` and the role
 * form does not ([#1564](https://github.com/publira/publira/issues/1564)), so
 * this field — which the Action revalidates — is what reports that a save
 * landed. Each value in the profile card is a paragraph of its own, and the role
 * badge holds nothing but the label.
 */
const currentRoleValue = (page: Page): Locator =>
  onlyVisible(page.getByRole("paragraph").filter({ hasText: ROLE_LABELS }));

/** The internal UUID an operator's audit rows carry as `target_id`. */
const operatorRowId = (email: string): string =>
  querySql(
    `SELECT id::text FROM platform_users WHERE email = '${email}' LIMIT 1`
  );

/**
 * Successful platform audit rows for one operator and one action.
 *
 * Pinned to that operator's UUID, because an action label alone also matches
 * leftover rows from earlier runs: nothing in the suite deletes
 * `platform_audit_logs` until `platform.setup.spec.ts` empties the platform at
 * the very end.
 */
const auditActionCount = (operatorId: string, action: string): string =>
  querySql(`
    SELECT COUNT(*)::text
    FROM platform_audit_logs
    WHERE target_type = 'operator'
      AND target_id = '${operatorId}'
      AND action = '${action}'
      AND outcome = 'success'
  `);

const changeRoleTo = async (page: Page, roleLabel: string): Promise<void> => {
  const form = roleForm(page);
  await form.getByRole("combobox").click();
  await page.getByRole("option", { exact: true, name: roleLabel }).click();
  await form.getByRole("button", { name: "保存" }).click();
  await expect(currentRoleValue(page)).toHaveText(roleLabel);
};

/**
 * Platform Console → platform API: operator management, the cross-tenant user
 * screens, and one tenant's member list.
 *
 * Isolated project `platform-operator-management` (see playwright.config.ts).
 * This suite rewrites the role and the status of two accounts seeded by
 * `030_platform_operators.sql`, and `platform.tenant-ops.spec.ts` re-applies
 * that same file from inside its own tests — which would put a deactivated
 * operator back to `active` half-way through an assertion here. Running after
 * the parallel web-platform project is what keeps the two apart.
 *
 * Operators invited during the suite are deleted in `afterEach`, and the
 * scenario accounts it mutates are restored by re-applying the file that seeds
 * them, so `task e2e:test` against a long-lived stack starts from the same state
 * every time.
 */
test.describe("platform operator management", () => {
  /** Addresses of the operators invited in the current test. */
  let invitedEmails: string[] = [];

  test.beforeEach(async ({ page }) => {
    invitedEmails = [];
    applyScenarioSql(PLATFORM_OPERATORS_SCENARIO);
    await signInAsSeedPlatformSuperAdmin(page);
  });

  test.afterEach(() => {
    deletePlatformOperatorsByEmails(invitedEmails);
    invitedEmails = [];
    applyScenarioSql(PLATFORM_OPERATORS_SCENARIO);
  });

  const trackOperator = (email: string): string => {
    invitedEmails.push(email);
    return email;
  };

  test("invites an operator with a role, and the list shows it", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Invited Operator ${suffix}`;
    const email = trackOperator(`invited-${suffix}@example.com`);

    await createOperatorViaUi(page, { email, name, roleLabel: "オペレーター" });

    const row = listRow(page, email);
    await expect(row.getByText(name)).toBeVisible();
    await expect(row.getByText("オペレーター", { exact: true })).toBeVisible();
    await expect(row.getByText("有効", { exact: true })).toBeVisible();

    // The row's own detail link, so the list is what carries the public_id.
    await row.getByRole("link", { name: "詳細" }).click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `オペレーター詳細: ${name}`,
      })
    ).toBeVisible();
    await expect(onlyVisible(page.getByText(email))).toBeVisible();
    await expect(currentRoleValue(page)).toHaveText("オペレーター");
  });

  test("changes a role, and the new permissions take effect on the next sign-in", async ({
    page,
  }) => {
    const detailPath = `/operators/${SCENARIO_ROLE_CHANGE_OPERATOR.publicId}`;

    await page.goto(platformUrl(detailPath));
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `オペレーター詳細: ${SCENARIO_ROLE_CHANGE_OPERATOR.name}`,
      })
    ).toBeVisible();
    await expect(roleForm(page).getByRole("combobox")).toHaveText(
      "オペレーター"
    );

    await changeRoleTo(page, "スーパー管理者");

    // Re-fetch so the saved role is what the screen reads, not the Action's
    // answer to the form that submitted it.
    await page.goto(platformUrl(detailPath));
    await expect(roleForm(page).getByRole("combobox")).toHaveText(
      "スーパー管理者"
    );

    await page.goto(platformUrl("/operators"));
    await expect(
      listRow(page, SCENARIO_ROLE_CHANGE_OPERATOR.email).getByText(
        "スーパー管理者",
        { exact: true }
      )
    ).toBeVisible();

    // What the promotion is worth: inviting an operator is super-admin only, and
    // `platform.tenant-ops.spec.ts` asserts the denial a plain operator gets.
    await signOutPlatform(page);
    await signInAsPlatformOperator(page, SCENARIO_ROLE_CHANGE_OPERATOR);

    const suffix = uniqueSuffix();
    const email = trackOperator(`promoted-${suffix}@example.com`);
    await createOperatorViaUi(page, {
      email,
      name: `E2E Promoted Invite ${suffix}`,
      roleLabel: "監査担当",
    });

    await expect(listRow(page, email).getByText("監査担当")).toBeVisible();
  });

  test("deactivating an operator keeps them out of the console", async ({
    page,
  }) => {
    const detailPath = `/operators/${SCENARIO_DEACTIVATED_OPERATOR.publicId}`;

    await page.goto(platformUrl(detailPath));
    await confirmDangerAction(page, "無効化", "無効化する");
    await page.waitForURL((url) => url.pathname === "/operators");

    await expect(
      listRow(page, SCENARIO_DEACTIVATED_OPERATOR.email).getByText("無効", {
        exact: true,
      })
    ).toBeVisible();

    // Deactivation is a status change rather than a delete — the audit trail has
    // to keep naming an account — so the row stays and the detail screen is what
    // reports that there is nothing left to do with it.
    await page.goto(platformUrl(detailPath));
    await expect(page.getByText("無効", { exact: true })).toBeVisible();
    await expect(page.getByText("ロール変更", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { exact: true, name: "無効化" })
    ).toHaveCount(0);

    await signOutPlatform(page);
    await fillLoginForm(page, SCENARIO_DEACTIVATED_OPERATOR);

    await expect(formMessage(page)).toContainText(LOGIN_FAILED_MESSAGE);
    await expect(page).toHaveURL(/\/login/u);
  });

  test("key operations are recorded in the audit log", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Audited Operator ${suffix}`;
    const email = trackOperator(`audited-${suffix}@example.com`);

    await createOperatorViaUi(page, { email, name, roleLabel: "オペレーター" });
    const operatorId = operatorRowId(email);
    expect(operatorId, `no platform_users row for ${email}`).not.toBe("");

    await listRow(page, email).getByRole("link", { name: "詳細" }).click();
    await changeRoleTo(page, "監査担当");

    await confirmDangerAction(page, "無効化", "無効化する");
    await page.waitForURL((url) => url.pathname === "/operators");

    expect(
      auditActionCount(operatorId, "operator_created"),
      "operator_created"
    ).toBe("1");
    expect(
      auditActionCount(operatorId, "operator_updated"),
      "operator_updated"
    ).toBe("1");
    expect(
      auditActionCount(operatorId, "operator_deleted"),
      "operator_deleted"
    ).toBe("1");

    // The log screen still surfaces the same event types under its own labels.
    await page.goto(platformUrl("/audit-logs?action=operator_created"));
    await expect(page.getByRole("heading", { name: "監査ログ" })).toBeVisible();
    await expect(page.getByText("オペレーターを作成").first()).toBeVisible();
    await expect(page.locator("table tbody tr").first()).toBeVisible();
  });

  test("lists users across tenants and opens one of them", async ({ page }) => {
    applyScenarioSql(NOTIFICATION_INBOX_SCENARIO);

    // 50 per page: the list is newest-first across every tenant and other suites
    // create readers of their own, so the two seeded ones are not on a page of 20
    // forever.
    const listPath = "/users?limit=50";
    await page.goto(platformUrl(listPath));
    await expect(
      page.getByRole("heading", { level: 1, name: "ユーザー管理" })
    ).toBeVisible();

    await expect(
      listRow(page, SEED_MEMBER_PUBLIC_ID).getByRole("link", {
        name: SEED_TENANT.name,
      })
    ).toHaveAttribute("href", `/tenants/${SEED_TENANT.publicId}`);
    await expect(
      listRow(page, NOTIFICATION_INBOX_MEMBER.publicId).getByRole("link", {
        name: NOTIFICATION_INBOX_TENANT.name,
      })
    ).toHaveAttribute("href", `/tenants/${NOTIFICATION_INBOX_TENANT.publicId}`);

    // Narrowing to one tenant is what proves the two rows above came from
    // different ones, rather than from a list whose tenant column is decoration.
    await page
      .getByRole("searchbox", { name: "テナント検索" })
      .fill(NOTIFICATION_INBOX_TENANT.name);
    await page.getByRole("button", { name: "絞り込む" }).click();
    await expect(
      listRow(page, NOTIFICATION_INBOX_MEMBER.publicId)
    ).toBeVisible();
    await expect(listRow(page, SEED_MEMBER_PUBLIC_ID)).toHaveCount(0);

    await page.goto(platformUrl(listPath));
    await listRow(page, SEED_MEMBER_PUBLIC_ID)
      .getByRole("link", { name: "詳細" })
      .click();

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `ユーザー詳細: ${SEED_MEMBER.name}`,
      })
    ).toBeVisible();
    await expect(onlyVisible(page.getByText(SEED_MEMBER.email))).toBeVisible();
    await expect(
      onlyVisible(page.getByText(SEED_MEMBER_PUBLIC_ID))
    ).toBeVisible();
    await expect(
      onlyVisible(
        page.getByRole("link", { exact: true, name: SEED_TENANT.name })
      )
    ).toHaveAttribute("href", `/tenants/${SEED_TENANT.publicId}`);
  });

  test("lists a tenant's members from the tenant detail", async ({ page }) => {
    await page.goto(platformUrl(`/tenants/${SEED_TENANT.publicId}`));
    await page.getByRole("link", { name: "メンバー管理" }).click();

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `メンバー管理: ${SEED_TENANT.name}`,
      })
    ).toBeVisible();

    // Rows are matched on the display name, not the address: `hasText` is a
    // substring match, and the scenario admin `auth-admin@example.com` ends in
    // the seeded admin's whole address.
    //
    // A tenant's members are its staff — the accounts `/users` leaves out,
    // because that screen lists exactly the users with no tenant role.
    const adminRow = listRow(page, SEED_ADMIN.name);
    await expect(adminRow.getByText(SEED_ADMIN.email)).toBeVisible();
    await expect(adminRow.getByText("テナント管理者")).toBeVisible();
    await expect(listRow(page, SEED_MEMBER.name)).toHaveCount(0);
    // The status column is not asserted: it words a person's account status with
    // the catalog written for a tenant
    // ([#1565](https://github.com/publira/publira/issues/1565)).
  });
});
