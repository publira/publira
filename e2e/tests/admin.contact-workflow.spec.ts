import type { Browser, Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { fillField, signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import {
  CONTACT_WORKFLOW_ADMIN,
  CONTACT_WORKFLOW_COLLEAGUE,
  CONTACT_WORKFLOW_EDITOR,
  CONTACT_WORKFLOW_HANDLED,
  CONTACT_WORKFLOW_IN_PROGRESS,
  CONTACT_WORKFLOW_SCENARIO,
  CONTACT_WORKFLOW_TENANT,
  CONTACT_WORKFLOW_UNHANDLED,
} from "../src/scenarios/contact-workflow";
import {
  hostPath,
  WEB_ADMIN_CONTACT_WORKFLOW_BASE_URL,
  WEB_HOST_CONTACT_WORKFLOW_BASE_URL,
} from "../src/urls";

type Staff = typeof CONTACT_WORKFLOW_ADMIN | typeof CONTACT_WORKFLOW_COLLEAGUE;

const SUBMIT_CONTACT_MESSAGE_PROCEDURE =
  "/api/publira.v1.ContactService/SubmitContactMessage";

const SEEDED_SUBJECTS = [
  CONTACT_WORKFLOW_UNHANDLED.subject,
  CONTACT_WORKFLOW_IN_PROGRESS.subject,
  CONTACT_WORKFLOW_HANDLED.subject,
] as const;

/** The note the colleague leaves on the walked message, which later steps keep. */
const COLLEAGUE_NOTE = "Asked the reader which device the episode stops on.";

const WALKED_MESSAGE_PATH = `/contact-messages/${CONTACT_WORKFLOW_UNHANDLED.publicId}`;

const signIn = (page: Page, staff: Staff, nextPath: string): Promise<void> =>
  signInAsAdmin(page, staff, nextPath, WEB_ADMIN_CONTACT_WORKFLOW_BASE_URL);

/**
 * Run `steps` as `staff` in a browser of their own, so two members of staff are
 * signed in at once the way they would be working the same inbox.
 */
const asStaff = async (
  browser: Browser,
  staff: Staff,
  nextPath: string,
  steps: (page: Page) => Promise<void>
): Promise<void> => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, staff, nextPath);
    await steps(page);
  } finally {
    await context.close();
  }
};

const inboxRow = (page: Page, subject: string): Locator =>
  page.getByRole("row").filter({
    has: page.getByRole("link", { exact: true, name: subject }),
  });

/**
 * Open a Select until its option `label` is on screen. Every step here ends on
 * a navigation, and a click that lands while the page is still taking the new
 * render in leaves the popup closed, so the click is repeated.
 */
const openSelect = async (
  page: Page,
  select: Locator,
  label: string
): Promise<Locator> => {
  const option = page.getByRole("option", { exact: true, name: label });
  await expect(async () => {
    if (!(await option.isVisible())) {
      await select.click();
    }
    await expect(option).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  return option;
};

const choose = async (
  page: Page,
  select: Locator,
  label: string
): Promise<void> => {
  const option = await openSelect(page, select, label);
  await option.click();
};

const filterInbox = async (page: Page, label: string): Promise<void> => {
  await choose(page, page.getByRole("combobox", { name: "Status" }), label);
  await page.getByRole("button", { name: "Apply" }).click();
};

/**
 * Filter the inbox to one state and see that exactly the seeded message in
 * that state is listed.
 */
const expectInboxFilter = async (
  page: Page,
  filter: { label: string; listed: string; value: string }
): Promise<void> => {
  await filterInbox(page, filter.label);

  await expect(page).toHaveURL(new RegExp(`[?&]status=${filter.value}`, "u"));
  await Promise.all(
    SEEDED_SUBJECTS.map((subject) =>
      expect(
        page.getByRole("link", { exact: true, name: subject })
      ).toHaveCount(subject === filter.listed ? 1 : 0)
    )
  );
};

/**
 * One value of the message's description list. The value is the `<dd>` that
 * follows the `<dt>` carrying the label, which keeps the Assignee row apart from
 * the Assignment section's picker of the same name.
 */
const detailValue = (page: Page, label: string): Locator =>
  page
    .locator("dt")
    .filter({ hasText: new RegExp(`^${label}$`, "u") })
    .locator("xpath=following-sibling::dd[1]");

const expectDetail = async (
  page: Page,
  expected: { assignee: string; status: string }
): Promise<void> => {
  await expect(detailValue(page, "Status")).toHaveText(expected.status);
  await expect(detailValue(page, "Assignee")).toHaveText(expected.assignee);
};

const assigneePicker = (page: Page): Locator =>
  page.getByRole("combobox", { name: "Assignee" });

const saveAssignee = async (page: Page, label: string): Promise<void> => {
  await choose(page, assigneePicker(page), label);
  await page
    .getByRole("button", { exact: true, name: "Save assignee" })
    .click();
};

const staffNote = (page: Page): Locator =>
  page.getByRole("textbox", { name: "Note" });

const saveStaffNote = async (page: Page, note: string): Promise<void> => {
  await fillField(staffNote(page), note);
  await page.getByRole("button", { exact: true, name: "Save note" }).click();
};

/**
 * Send a contact message through the public API the way the tenant's site
 * does, and return the response body as the reader's browser receives it.
 *
 * The request is sent from inside a page on the tenant's site so it goes
 * through the edge on that site's host, the only door a reader has to the API.
 */
const submitThroughPublicApi = async (
  page: Page,
  message: { body: string; replyToEmail: string; subject: string }
): Promise<{ body: unknown; status: number }> => {
  await page.goto(`${WEB_HOST_CONTACT_WORKFLOW_BASE_URL}${hostPath("/")}`);
  return page.evaluate(
    async ({ path, request }) => {
      const response = await fetch(path, {
        body: JSON.stringify(request),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      return { body: await response.json(), status: response.status };
    },
    {
      path: SUBMIT_CONTACT_MESSAGE_PROCEDURE,
      request: { ...message, tenant: { tenantId: CONTACT_WORKFLOW_TENANT.id } },
    }
  );
};

/**
 * Two tenant admins sharing one contact inbox: who owns a message, where it
 * stands, and the note they keep on it, carried from one of them to the other.
 *
 * The status is derived from the assignee and whether the message has been
 * handled, so every step reads it back from the screen rather than trusting
 * the toast. Reading and marking a single message on its own is
 * `admin.contact-inbox.spec.ts`; sending one from the public site is
 * `host.contact-form.spec.ts`.
 */
test.describe("web-admin contact-message workflow between staff", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    applyScenarioSql(CONTACT_WORKFLOW_SCENARIO);
  });

  test.afterAll(() => {
    applyScenarioSql(CONTACT_WORKFLOW_SCENARIO);
  });

  test("the inbox names each message's assignee and filters by each of the three states", async ({
    page,
  }) => {
    await signIn(page, CONTACT_WORKFLOW_ADMIN, "/contact-messages");

    const unhandled = inboxRow(page, CONTACT_WORKFLOW_UNHANDLED.subject);
    await expect(
      unhandled.getByText("Unhandled", { exact: true })
    ).toBeVisible();
    await expect(
      unhandled.getByText("Unassigned", { exact: true })
    ).toBeVisible();

    const inProgress = inboxRow(page, CONTACT_WORKFLOW_IN_PROGRESS.subject);
    await expect(
      inProgress.getByText("In progress", { exact: true })
    ).toBeVisible();
    await expect(
      inProgress.getByRole("cell", {
        exact: true,
        name: CONTACT_WORKFLOW_COLLEAGUE.name,
      })
    ).toBeVisible();

    // The colleague marked this one handled, but the admin is who it is
    // assigned to, and the assignee is the only person the inbox names.
    const handled = inboxRow(page, CONTACT_WORKFLOW_HANDLED.subject);
    await expect(handled.getByText("Handled", { exact: true })).toBeVisible();
    await expect(
      handled.getByRole("cell", {
        exact: true,
        name: CONTACT_WORKFLOW_ADMIN.name,
      })
    ).toBeVisible();
    await expect(
      handled.getByRole("cell", {
        exact: true,
        name: CONTACT_WORKFLOW_COLLEAGUE.name,
      })
    ).toHaveCount(0);

    await expectInboxFilter(page, {
      label: "Unhandled",
      listed: CONTACT_WORKFLOW_UNHANDLED.subject,
      value: "unhandled",
    });
    await expectInboxFilter(page, {
      label: "In progress",
      listed: CONTACT_WORKFLOW_IN_PROGRESS.subject,
      value: "in_progress",
    });
    await expectInboxFilter(page, {
      label: "Handled",
      listed: CONTACT_WORKFLOW_HANDLED.subject,
      value: "handled",
    });
  });

  test("an admin hands a message to a colleague, who finds it in progress and leaves a note", async ({
    browser,
    page,
  }) => {
    await signIn(page, CONTACT_WORKFLOW_ADMIN, WALKED_MESSAGE_PATH);
    await expectDetail(page, { assignee: "Unassigned", status: "Unhandled" });

    // Every tenant admin can be given the message; the editor cannot open the
    // inbox, so is not offered.
    await openSelect(page, assigneePicker(page), "Unassigned");
    await Promise.all(
      [CONTACT_WORKFLOW_ADMIN.name, CONTACT_WORKFLOW_COLLEAGUE.name].map(
        (name) =>
          expect(page.getByRole("option", { exact: true, name })).toBeVisible()
      )
    );
    await expect(
      page.getByRole("option", {
        exact: true,
        name: CONTACT_WORKFLOW_EDITOR.name,
      })
    ).toHaveCount(0);
    await page
      .getByRole("option", {
        exact: true,
        name: CONTACT_WORKFLOW_COLLEAGUE.name,
      })
      .click();
    await page
      .getByRole("button", { exact: true, name: "Save assignee" })
      .click();

    await expect(page.getByText("The assignee has been saved.")).toBeVisible();
    await expectDetail(page, {
      assignee: CONTACT_WORKFLOW_COLLEAGUE.name,
      status: "In progress",
    });

    await asStaff(
      browser,
      CONTACT_WORKFLOW_COLLEAGUE,
      "/contact-messages",
      async (colleague) => {
        await filterInbox(colleague, "In progress");
        const row = inboxRow(colleague, CONTACT_WORKFLOW_UNHANDLED.subject);
        await expect(
          row.getByRole("cell", {
            exact: true,
            name: CONTACT_WORKFLOW_COLLEAGUE.name,
          })
        ).toBeVisible();

        await row
          .getByRole("link", {
            exact: true,
            name: CONTACT_WORKFLOW_UNHANDLED.subject,
          })
          .click();
        await expect(colleague).toHaveURL(
          new RegExp(`${WALKED_MESSAGE_PATH}$`, "u")
        );
        await expectDetail(colleague, {
          assignee: CONTACT_WORKFLOW_COLLEAGUE.name,
          status: "In progress",
        });
        // The message is already theirs.
        await expect(
          colleague.getByRole("button", { exact: true, name: "Assign to me" })
        ).toHaveCount(0);

        await saveStaffNote(colleague, COLLEAGUE_NOTE);

        await expect(
          colleague.getByText("The staff note has been saved.")
        ).toBeVisible();
        await expect(staffNote(colleague)).toHaveValue(COLLEAGUE_NOTE);
      }
    );

    // The note is one shared note, so the admin reads what the colleague saved,
    // and saving it moved neither the status nor the assignee.
    await page.reload();
    await expect(staffNote(page)).toHaveValue(COLLEAGUE_NOTE);
    await expectDetail(page, {
      assignee: CONTACT_WORKFLOW_COLLEAGUE.name,
      status: "In progress",
    });
  });

  test("taking a message over, handling it, and reopening it keep the assignee, and clearing it leaves the message unhandled", async ({
    page,
  }) => {
    await signIn(page, CONTACT_WORKFLOW_ADMIN, WALKED_MESSAGE_PATH);

    await page
      .getByRole("button", { exact: true, name: "Assign to me" })
      .click();

    await expect(page.getByText("The assignee has been saved.")).toBeVisible();
    await expectDetail(page, {
      assignee: CONTACT_WORKFLOW_ADMIN.name,
      status: "In progress",
    });
    await expect(
      page.getByRole("button", { exact: true, name: "Assign to me" })
    ).toHaveCount(0);

    await page
      .getByRole("button", { exact: true, name: "Mark handled" })
      .click();

    await expect(
      page.getByText("The message has been marked handled.")
    ).toBeVisible();
    await expectDetail(page, {
      assignee: CONTACT_WORKFLOW_ADMIN.name,
      status: "Handled",
    });

    await page.getByRole("button", { exact: true, name: "Reopen" }).click();

    // Reopened with an assignee, the message goes back to that person rather
    // than to the unhandled pile.
    await expect(
      page.getByText("The message has been reopened.")
    ).toBeVisible();
    await expectDetail(page, {
      assignee: CONTACT_WORKFLOW_ADMIN.name,
      status: "In progress",
    });

    await saveAssignee(page, "Unassigned");

    await expect(
      page.getByText("The message is no longer assigned to anyone.")
    ).toBeVisible();
    await expectDetail(page, { assignee: "Unassigned", status: "Unhandled" });
    await expect(staffNote(page)).toHaveValue(COLLEAGUE_NOTE);

    await page
      .getByRole("link", { exact: true, name: "Back to contact messages" })
      .click();
    await filterInbox(page, "Unhandled");
    const row = inboxRow(page, CONTACT_WORKFLOW_UNHANDLED.subject);
    await expect(row.getByText("Unassigned", { exact: true })).toBeVisible();
  });

  test("staff edit the shared note and clear it", async ({ browser, page }) => {
    const edited =
      "The reader is on an older tablet. Sent the support article.";
    await signIn(page, CONTACT_WORKFLOW_ADMIN, WALKED_MESSAGE_PATH);

    await saveStaffNote(page, edited);
    await expect(
      page.getByText("The staff note has been saved.")
    ).toBeVisible();

    await asStaff(
      browser,
      CONTACT_WORKFLOW_COLLEAGUE,
      WALKED_MESSAGE_PATH,
      async (colleague) => {
        await expect(staffNote(colleague)).toHaveValue(edited);

        // Saving the field empty is how the note is cleared.
        await saveStaffNote(colleague, "");

        await expect(
          colleague.getByText("The staff note has been cleared.")
        ).toBeVisible();
        await expect(staffNote(colleague)).toHaveValue("");
      }
    );

    await page.reload();
    await expect(staffNote(page)).toHaveValue("");
  });

  test("the public contact API answers with nothing of a message, its staff note included", async ({
    page,
  }) => {
    // The note is stored on the reader's earlier message, where staff read it.
    await signIn(
      page,
      CONTACT_WORKFLOW_ADMIN,
      `/contact-messages/${CONTACT_WORKFLOW_IN_PROGRESS.publicId}`
    );
    await expect(staffNote(page)).toHaveValue(
      CONTACT_WORKFLOW_IN_PROGRESS.staffNote
    );

    // The same reader writing again is told their message was accepted and
    // nothing more. One submission only: the public API's allowance per client
    // is small and shared with every other suite that sends one.
    const response = await submitThroughPublicApi(page, {
      body: "The same typo is on the fourth page as well.",
      replyToEmail: CONTACT_WORKFLOW_IN_PROGRESS.replyToEmail,
      subject: CONTACT_WORKFLOW_IN_PROGRESS.subject,
    });
    expect(response).toEqual({ body: {}, status: 200 });
  });
});
