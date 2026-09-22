import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { fillField, selectOption, signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import {
  clearMessagesTo,
  countMessagesTo,
  tokenFromLink,
  waitForMessageTo,
} from "../src/mail";
import {
  TENANT_MEMBERS_ADMIN,
  TENANT_MEMBERS_EDITOR,
  TENANT_MEMBERS_INVITEE,
  TENANT_MEMBERS_SCENARIO,
} from "../src/scenarios/tenant-members";
import { WEB_ADMIN_TENANT_MEMBERS_BASE_URL } from "../src/urls";

/**
 * A tenant admin managing who else can use the console: inviting an
 * administrator who accepts on the acceptance screen, granting the role to an
 * existing account, changing and removing members, and being stopped before
 * the tenant is left without an admin. None of it touches the Platform
 * Console.
 */

const MEMBERS_PATH = "/members";
const ACCEPT_INVITE_PATH = "/accept-invite";
const SECOND_INVITEE = "team-second-invitee@example.com";

const LAST_ADMIN_DEMOTE =
  "This member is the tenant's last tenant admin. Make someone else a tenant admin before changing this role.";
const LAST_ADMIN_REMOVE =
  "This member is the tenant's last tenant admin. Make someone else a tenant admin before removing them.";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_TENANT_MEMBERS_BASE_URL}${pathname}`;

const signIn = (
  page: Page,
  credentials: { email: string; password: string },
  nextPath: string
): Promise<void> =>
  signInAsAdmin(page, credentials, nextPath, WEB_ADMIN_TENANT_MEMBERS_BASE_URL);

const openMembers = async (page: Page): Promise<void> => {
  await page.goto(adminUrl(MEMBERS_PATH));
  await expect(
    page.getByRole("heading", { level: 1, name: "Members" })
  ).toBeVisible();
};

// The page is a <section> as well, and holds both headings; only the sections
// inside it hold one list each.
const membersSection = (page: Page): Locator =>
  page.locator("section section").filter({
    has: page.getByRole("heading", { exact: true, level: 2, name: "Members" }),
  });

const invitationsSection = (page: Page): Locator =>
  page.locator("section section").filter({
    has: page.getByRole("heading", { level: 2, name: "Admin invitations" }),
  });

const memberRow = (page: Page, email: string): Locator =>
  membersSection(page).getByRole("row").filter({ hasText: email });

const invitationRow = (page: Page, email: string): Locator =>
  invitationsSection(page).getByRole("row").filter({ hasText: email });

const changeRole = async (
  page: Page,
  row: Locator,
  roleLabel: string
): Promise<void> => {
  await selectOption(page, row.getByRole("combobox"), roleLabel);
  await row.getByRole("button", { name: "Change role" }).click();
};

const confirmIn = async (
  page: Page,
  row: Locator,
  trigger: string,
  confirm: string
): Promise<void> => {
  await row.getByRole("button", { name: trigger }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: confirm })
    .click();
};

const invite = async (page: Page, email: string): Promise<void> => {
  await fillField(page.getByLabel("Email address to invite"), email);
  await page.getByRole("button", { name: "Send invitation" }).click();
};

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  applyScenarioSql(TENANT_MEMBERS_SCENARIO);
  await clearMessagesTo(TENANT_MEMBERS_INVITEE.email);
  await clearMessagesTo(TENANT_MEMBERS_EDITOR.email);
  await clearMessagesTo(SECOND_INVITEE);
});

test.afterAll(() => {
  applyScenarioSql(TENANT_MEMBERS_SCENARIO);
});

test.describe("tenant members", () => {
  test("an editor sees neither the Members entry nor its route", async ({
    page,
  }) => {
    await signIn(page, TENANT_MEMBERS_EDITOR, "/");

    await expect(
      page.getByRole("link", { exact: true, name: "Audit logs" })
    ).toBeVisible();
    // The entry and the account menu wait on the same read of the operator, so
    // once the menu carries the editor's name the entry has had its answer.
    await expect(
      page.getByRole("button", { name: /Team E2E Editor/u })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { exact: true, name: "Members" })
    ).toHaveCount(0);

    await page.goto(adminUrl(MEMBERS_PATH));
    await expect(
      page.getByRole("heading", { name: "Page not found" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: "Members" })
    ).toHaveCount(0);
  });

  test("refuses to demote or remove the tenant's last admin", async ({
    page,
  }) => {
    await signIn(page, TENANT_MEMBERS_ADMIN, "/");
    await page.getByRole("link", { exact: true, name: "Members" }).click();
    await expect(page).toHaveURL(adminUrl(MEMBERS_PATH));

    const ownRow = memberRow(page, TENANT_MEMBERS_ADMIN.email);
    await changeRole(page, ownRow, "Editor");
    await expect(ownRow.getByText(LAST_ADMIN_DEMOTE)).toBeVisible();

    await confirmIn(page, ownRow, "Remove", "Remove");
    await expect(ownRow.getByText(LAST_ADMIN_REMOVE)).toBeVisible();
  });

  test("invites an administrator who accepts on the acceptance screen", async ({
    browser,
    page,
  }) => {
    await signIn(page, TENANT_MEMBERS_ADMIN, MEMBERS_PATH);
    await invite(page, TENANT_MEMBERS_INVITEE.email);
    await expect(
      page.getByText(
        `An invitation was sent to ${TENANT_MEMBERS_INVITEE.email}.`
      )
    ).toBeVisible();
    await expect(
      invitationRow(page, TENANT_MEMBERS_INVITEE.email).getByText("Pending")
    ).toBeVisible();

    const message = await waitForMessageTo(TENANT_MEMBERS_INVITEE.email);
    const token = tokenFromLink(message, ACCEPT_INVITE_PATH);

    // The invitee is somebody else, in a browser with no admin session.
    const inviteeContext = await browser.newContext();
    try {
      const invitee = await inviteeContext.newPage();
      await invitee.goto(
        adminUrl(`${ACCEPT_INVITE_PATH}?token=${encodeURIComponent(token)}`)
      );
      await fillField(
        invitee.getByLabel("Full name"),
        TENANT_MEMBERS_INVITEE.name
      );
      await fillField(
        // The required mark is part of the label, so "Password" alone matches both.
        invitee.getByLabel(/^Password\W*$/u),
        TENANT_MEMBERS_INVITEE.password
      );
      await fillField(
        invitee.getByLabel("Password (confirm)"),
        TENANT_MEMBERS_INVITEE.password
      );
      await invitee.getByRole("button", { name: "Accept invitation" }).click();
      await invitee.waitForURL((url) => url.pathname.endsWith("/login"));

      await signIn(invitee, TENANT_MEMBERS_INVITEE, MEMBERS_PATH);
      await expect(
        invitee.getByRole("heading", { level: 1, name: "Members" })
      ).toBeVisible();
    } finally {
      await inviteeContext.close();
    }

    await openMembers(page);
    await expect(
      invitationRow(page, TENANT_MEMBERS_INVITEE.email).getByText("Accepted")
    ).toBeVisible();
    await expect(
      memberRow(page, TENANT_MEMBERS_INVITEE.email).getByRole("combobox")
    ).toHaveText("Tenant admin");
  });

  test("changes and removes a member once another admin exists", async ({
    page,
  }) => {
    await signIn(page, TENANT_MEMBERS_ADMIN, MEMBERS_PATH);

    const inviteeRow = memberRow(page, TENANT_MEMBERS_INVITEE.email);
    await changeRole(page, inviteeRow, "Auditor");
    await expect(inviteeRow.getByText("Role updated.")).toBeVisible();
    await expect(inviteeRow.getByRole("combobox")).toHaveText("Auditor");

    await confirmIn(page, inviteeRow, "Remove", "Remove");
    await expect(page.getByText("Member removed.")).toBeVisible();
    await expect(inviteeRow).toHaveCount(0);
  });

  test("grants the role on the spot to an address that already has an account", async ({
    page,
  }) => {
    await signIn(page, TENANT_MEMBERS_ADMIN, MEMBERS_PATH);
    await invite(page, TENANT_MEMBERS_EDITOR.email);

    await expect(
      page.getByText(
        `${TENANT_MEMBERS_EDITOR.email} already has an account in this tenant and is now a tenant admin. No invitation email was sent.`
      )
    ).toBeVisible();
    await expect(
      memberRow(page, TENANT_MEMBERS_EDITOR.email).getByRole("combobox")
    ).toHaveText("Tenant admin");
    expect(await countMessagesTo(TENANT_MEMBERS_EDITOR.email)).toBe(0);
  });

  test("resends and cancels a pending invitation", async ({ page }) => {
    await signIn(page, TENANT_MEMBERS_ADMIN, MEMBERS_PATH);
    await invite(page, SECOND_INVITEE);
    await expect(
      page.getByText(`An invitation was sent to ${SECOND_INVITEE}.`)
    ).toBeVisible();

    const row = invitationRow(page, SECOND_INVITEE);
    await row.getByRole("button", { name: "Resend" }).click();
    await expect(row.getByText("The invitation was sent again.")).toBeVisible();

    await confirmIn(page, row, "Cancel invitation", "Cancel invitation");
    await expect(page.getByText("Invitation canceled.")).toBeVisible();
    await expect(row.getByText("Canceled")).toBeVisible();
    await expect(row.getByRole("button", { name: "Resend" })).toHaveCount(0);
  });

  test("labels every change in the audit log", async ({ page }) => {
    await signIn(page, TENANT_MEMBERS_ADMIN, "/audit-logs");

    const actions = page.getByRole("table");
    await Promise.all(
      [
        "Tenant admin invited",
        "Admin invitation resent",
        "Admin invitation canceled",
        "Member role changed",
        "Member removed",
      ].map((label) =>
        expect(actions.getByText(label, { exact: true }).first()).toBeVisible()
      )
    );
  });
});
