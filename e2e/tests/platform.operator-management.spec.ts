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
    .filter({ has: page.getByRole("button", { name: "Save" }) });

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

/** The three role labels, which are the only values `Current role` can hold. */
const ROLE_LABELS = /^(?:Auditor|Operator|Super admin)$/u;

/**
 * The role shown in the operator profile card. Each value in that card is a
 * paragraph of its own, and the role badge holds nothing but the label.
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
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("status")).toContainText("Role updated.");
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

    await createOperatorViaUi(page, { email, name, roleLabel: "Operator" });

    const row = listRow(page, email);
    await expect(row.getByText(name)).toBeVisible();
    await expect(row.getByText("Operator", { exact: true })).toBeVisible();
    await expect(row.getByText("Active", { exact: true })).toBeVisible();

    // The row's own detail link, so the list is what carries the public_id.
    await row.getByRole("link", { name: "Details" }).click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `Operator: ${name}`,
      })
    ).toBeVisible();
    await expect(onlyVisible(page.getByText(email))).toBeVisible();
    await expect(currentRoleValue(page)).toHaveText("Operator");
  });

  test("changes a role, and the new permissions take effect on the next sign-in", async ({
    page,
  }) => {
    const detailPath = `/operators/${SCENARIO_ROLE_CHANGE_OPERATOR.publicId}`;

    await page.goto(platformUrl(detailPath));
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `Operator: ${SCENARIO_ROLE_CHANGE_OPERATOR.name}`,
      })
    ).toBeVisible();
    await expect(roleForm(page).getByRole("combobox")).toHaveText("Operator");

    await changeRoleTo(page, "Super admin");

    // Re-fetch so the saved role is what the screen reads, not the Action's
    // answer to the form that submitted it.
    await page.goto(platformUrl(detailPath));
    await expect(roleForm(page).getByRole("combobox")).toHaveText(
      "Super admin"
    );

    await page.goto(platformUrl("/operators"));
    await expect(
      listRow(page, SCENARIO_ROLE_CHANGE_OPERATOR.email).getByText(
        "Super admin",
        {
          exact: true,
        }
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
      roleLabel: "Auditor",
    });

    await expect(listRow(page, email).getByText("Auditor")).toBeVisible();
  });

  test("deactivating an operator keeps them out of the console", async ({
    page,
  }) => {
    const detailPath = `/operators/${SCENARIO_DEACTIVATED_OPERATOR.publicId}`;

    await page.goto(platformUrl(detailPath));
    await confirmDangerAction(page, "Deactivate", "Deactivate");
    await page.waitForURL((url) => url.pathname === "/operators");

    await expect(
      listRow(page, SCENARIO_DEACTIVATED_OPERATOR.email).getByText("Inactive", {
        exact: true,
      })
    ).toBeVisible();

    // Deactivation is a status change rather than a delete — the audit trail has
    // to keep naming an account — so the row stays and the detail screen is what
    // reports that there is nothing left to do with it.
    await page.goto(platformUrl(detailPath));
    await expect(page.getByText("Inactive", { exact: true })).toBeVisible();
    await expect(page.getByText("Change role", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { exact: true, name: "Deactivate" })
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

    await createOperatorViaUi(page, { email, name, roleLabel: "Operator" });
    const operatorId = operatorRowId(email);
    expect(operatorId, `no platform_users row for ${email}`).not.toBe("");

    await listRow(page, email).getByRole("link", { name: "Details" }).click();
    await changeRoleTo(page, "Auditor");

    await confirmDangerAction(page, "Deactivate", "Deactivate");
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
    await expect(
      page.getByRole("heading", { name: "Audit logs" })
    ).toBeVisible();
    await expect(
      page.getByText("Created an operator", { exact: true }).first()
    ).toBeVisible();
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
      page.getByRole("heading", { level: 1, name: "Users" })
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
      .getByRole("searchbox", { name: "Search tenants" })
      .fill(NOTIFICATION_INBOX_TENANT.name);
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(
      listRow(page, NOTIFICATION_INBOX_MEMBER.publicId)
    ).toBeVisible();
    await expect(listRow(page, SEED_MEMBER_PUBLIC_ID)).toHaveCount(0);

    await page.goto(platformUrl(listPath));
    await listRow(page, SEED_MEMBER_PUBLIC_ID)
      .getByRole("link", { name: "Details" })
      .click();

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `User: ${SEED_MEMBER.name}`,
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
    await page.getByRole("link", { name: "Members" }).click();

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `Members: ${SEED_TENANT.name}`,
      })
    ).toBeVisible();

    // Rows are matched on the name cell rather than on the row's whole text:
    // the address would also select the scenario admin `auth-admin@example.com`,
    // which ends in the seeded admin's whole address, and `hasText` is a
    // case-insensitive substring match that the role cell `Tenant admin`
    // satisfies as readily as the display name `Tenant Admin` does. `exact`
    // matching on the cell is case-sensitive, so it tells those two apart.
    //
    // A tenant's members are its staff — the accounts `/users` leaves out,
    // because that screen lists exactly the users with no tenant role.
    const memberRow = (name: string): Locator =>
      page
        .getByRole("row")
        .filter({ has: page.getByRole("cell", { exact: true, name }) });

    const adminRow = memberRow(SEED_ADMIN.name);
    await expect(adminRow.getByText(SEED_ADMIN.email)).toBeVisible();
    await expect(
      adminRow.getByRole("cell", { exact: true, name: "Tenant admin" })
    ).toBeVisible();
    await expect(memberRow(SEED_MEMBER.name)).toHaveCount(0);
    // The status column is not asserted: it words a person's account status with
    // the catalog written for a tenant
    // ([#1565](https://github.com/publira/publira/issues/1565)).
  });
});
