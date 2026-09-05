import "temporal-polyfill/global";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  createLabelViaUi,
  selectComboboxOption,
  signInAsAdmin,
  signInAsSeedAdmin,
} from "../src/admin";
import { applyScenarioSql, deleteLabelsByPublicIds } from "../src/db";
import { SEED_ADMIN, uniqueSuffix } from "../src/scenarios/admin-publish";
import {
  ADMIN_REPORTING_SCENARIO,
  BOUNDARY_ADMIN,
  BOUNDARY_AUDIT,
  REPORTING_AUDIT,
  REPORTING_READ_THROUGH,
} from "../src/scenarios/admin-reporting";
import {
  SEED_ADMIN_PUBLIC_ID,
  SEED_MEMBER_PUBLIC_ID,
  SEED_TENANT_TIME_ZONE,
} from "../src/scenarios/auth";
import { MULTI_TENANT_SCENARIO } from "../src/scenarios/multi-tenant";
import {
  WEB_ADMIN_BASE_URL,
  WEB_ADMIN_OTHER_TENANT_BASE_URL,
} from "../src/urls";

/** Keep in sync with `pageSize` in the web-admin audit log page. */
const AUDIT_PAGE_SIZE = 20;

/** Keep in sync with `DEFAULT_PAGE_SIZE` in `apps/web-admin/lib/cursor-page.ts`. */
const READ_THROUGH_PAGE_SIZE = 20;

/**
 * How many of the tenant's days the read-through report covers, ending
 * yesterday. Keep in sync with `readThroughWindowDays` in
 * `server/api/adminapi/engagement_handlers.go`.
 */
const READ_THROUGH_WINDOW_DAYS = 28;

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

const auditLogsUrl = (params: Record<string, string> = {}): string => {
  const query = new URLSearchParams(params).toString();
  return adminUrl(query ? `/audit-logs?${query}` : "/audit-logs");
};

/** Every entry row of the audit table: the ones with an outcome badge. */
const auditEntryRows = (page: Page): Locator =>
  page.getByRole("row").filter({ hasText: /Success|Failure/u });

/** Rows of the audit table that carry one of this suite's target ids. */
const auditRows = (page: Page, targetIdPrefix = "rpt-audit-"): Locator =>
  page.getByRole("row").filter({ hasText: targetIdPrefix });

const auditRow = (page: Page, targetId: string): Locator =>
  page.getByRole("row").filter({ hasText: targetId });

/** Target ids of the listed audit rows, in table order. */
const auditTargetIds = async (page: Page): Promise<string[]> => {
  const texts = await auditRows(page).allTextContents();
  return texts.map((text) => text.match(/rpt-audit-\d{3}/u)?.[0] ?? "");
};

const auditFilterForm = (page: Page) => ({
  action: page.getByLabel("Action", { exact: true }),
  actor: page.getByRole("combobox", { name: "Actor" }),
  apply: page.getByRole("button", { name: "Apply" }),
  from: page.getByLabel("From", { exact: true }),
  to: page.getByLabel("To", { exact: true }),
});

/** The audit list's page links. They render only where a page exists. */
const auditPageLink = (page: Page, label: "Next" | "Previous"): Locator =>
  page.getByRole("link", { exact: true, name: label });

/**
 * Follow an audit page link and wait for the rows to catch up with the URL.
 * The list renders behind Suspense, so the URL changes while the previous
 * page's rows are still mounted, and then no row at all is mounted while the
 * next page streams in. Rows being back with a different leading target id is
 * what proves the move landed: every page of this suite's range starts on a
 * different one.
 */
const moveAuditPage = async (
  page: Page,
  label: "Next" | "Previous"
): Promise<void> => {
  const fromUrl = page.url();
  const fromIds = await auditTargetIds(page);
  const fromLeadingId = fromIds[0] ?? "";

  await auditPageLink(page, label).click();

  await page.waitForURL((url) => url.toString() !== fromUrl);
  await expect
    .poll(async () => {
      const ids = await auditTargetIds(page);
      return ids.length > 0 && ids[0] !== fromLeadingId;
    })
    .toBe(true);
};

/** The engagement table's row for one episode, by its title cell. */
const readThroughRow = (page: Page, episodeTitle: string): Locator =>
  page.getByRole("row").filter({
    has: page.getByRole("cell", { exact: true, name: episodeTitle }),
  });

/** Every episode row of the engagement table: the ones with a rate cell. */
const readThroughRows = (page: Page): Locator =>
  page.getByRole("row").filter({ hasText: /\d+\.\d%$/u });

const readThroughPagination = (page: Page): Locator =>
  page.getByRole("navigation", { name: "Read-through pages" });

/** The value under one label of the summary card. */
const summaryValue = (page: Page, label: string): Locator =>
  page
    .locator("p")
    .filter({ hasText: new RegExp(`^${label}$`, "u") })
    .locator("xpath=following-sibling::p[1]");

const expectReadThroughRow = async (
  row: Locator,
  expected: {
    completeCount: number;
    memberViewCount: number;
    rate: string;
  }
): Promise<void> => {
  const cells = row.getByRole("cell");
  await expect(cells.nth(2)).toHaveText(String(expected.completeCount));
  await expect(cells.nth(3)).toHaveText(String(expected.memberViewCount));
  await expect(cells.nth(4)).toHaveText(expected.rate);
};

/**
 * The period the report names: the window's days in the seed tenant's own time
 * zone, worded the way the summary card formats a plain date in English. The
 * card names that zone too, so this asserts the report counts the tenant's days
 * rather than UTC ones — the two disagree for nine hours of every day.
 */
const expectedPeriodText = (): string => {
  const end = Temporal.Now.plainDateISO(SEED_TENANT_TIME_ZONE).subtract({
    days: 1,
  });
  const start = end.subtract({ days: READ_THROUGH_WINDOW_DAYS - 1 });
  const formatter = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  });
  const format = (date: Temporal.PlainDate): string =>
    formatter.format(date.toZonedDateTime("UTC").epochMilliseconds);

  return `${format(start)} - ${format(end)}, counted in calendar days in the tenant's time zone (${SEED_TENANT_TIME_ZONE}).`;
};

/**
 * The two read-only screens a tenant admin consults: the audit log under
 * `/audit-logs` and the read-through report under `/engagement`. Both are
 * driven by `searchParams`, which is where a bad URL has to degrade to the
 * default view instead of failing.
 *
 * The rows the assertions count come from `120_admin_reporting.sql`, which
 * pins the audit entries to January 2026 and the read-through aggregates to
 * the report's window, so the parallel specs can write to the same tenant
 * without moving a number here.
 */
test.describe("admin reporting screens", () => {
  /** Label public_ids created by the current test; drained by afterEach. */
  let createdLabelIds: string[] = [];

  test.beforeAll(() => {
    applyScenarioSql(MULTI_TENANT_SCENARIO);
    applyScenarioSql(ADMIN_REPORTING_SCENARIO);
  });

  test.beforeEach(() => {
    createdLabelIds = [];
  });

  test.afterEach(() => {
    deleteLabelsByPublicIds(createdLabelIds);
    createdLabelIds = [];
  });

  test("the audit log lists the tenant's entries, and an action taken in the console joins them", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/audit-logs");
    await expect(
      page.getByRole("heading", { name: "Audit log" })
    ).toBeVisible();

    // Newest first: the seeded January entries sit behind the development
    // seed's, so the first page is full without any of them on it.
    await expect(auditEntryRows(page)).toHaveCount(AUDIT_PAGE_SIZE);
    await expect(auditPageLink(page, "Next")).toBeVisible();
    await expect(auditPageLink(page, "Previous")).toHaveCount(0);

    // A label created through the console is what the next read shows.
    const labelPublicId = await createLabelViaUi(
      page,
      `E2E Audit Label ${uniqueSuffix()}`
    );
    createdLabelIds.push(labelPublicId);

    // The audit row is written by an asynchronous recorder behind the API, so
    // the read polls rather than assuming it landed with the response.
    await expect(async () => {
      await page.goto(auditLogsUrl({ action: "label_created" }));
      await expect(auditRow(page, labelPublicId)).toBeVisible({
        timeout: 5000,
      });
    }).toPass({ timeout: 30_000 });

    const row = auditRow(page, labelPublicId);
    await expect(row).toContainText("Label created");
    await expect(row).toContainText(SEED_ADMIN.name);
    await expect(row).toContainText("Success");
  });

  test("filters narrow the list and survive a reload through the URL", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/audit-logs");
    const form = auditFilterForm(page);

    // A calendar day inside the seeded range, through the form.
    await form.from.fill(REPORTING_AUDIT.singleDay);
    await form.to.fill(REPORTING_AUDIT.singleDay);
    await form.apply.click();
    await page.waitForURL(/[?&]from=2026-01-10/u);

    await expect(auditRows(page)).toHaveCount(
      REPORTING_AUDIT.singleDayTargetIds.length
    );
    await expect(auditTargetIds(page)).resolves.toEqual([
      ...REPORTING_AUDIT.singleDayTargetIds,
    ]);

    // Narrowed again by action.
    await form.action.selectOption("label_updated");
    await form.apply.click();
    await page.waitForURL(/[?&]action=label_updated/u);

    await expect(auditRows(page)).toHaveCount(1);
    await expect(
      auditRow(page, REPORTING_AUDIT.singleDayLabelUpdatedTargetId)
    ).toContainText("Label updated");

    // The URL is the filter state: a reload shows the same narrowed list with
    // the form still holding what was applied.
    await page.reload();
    await expect(auditRows(page)).toHaveCount(1);
    await expect(
      auditRow(page, REPORTING_AUDIT.singleDayLabelUpdatedTargetId)
    ).toBeVisible();
    await expect(form.from).toHaveValue(REPORTING_AUDIT.singleDay);
    await expect(form.to).toHaveValue(REPORTING_AUDIT.singleDay);
    await expect(form.action).toHaveValue("label_updated");

    // The actor filter, picked from the combobox: the same day without the
    // one entry the member made on it.
    await page.goto(
      auditLogsUrl({
        from: REPORTING_AUDIT.singleDay,
        to: REPORTING_AUDIT.singleDay,
      })
    );
    await expect(auditRows(page)).toHaveCount(
      REPORTING_AUDIT.singleDayTargetIds.length
    );
    await selectComboboxOption(
      page,
      form.actor,
      `${SEED_ADMIN.name} (${SEED_ADMIN_PUBLIC_ID})`
    );
    await form.apply.click();
    await page.waitForURL(/[?&]actor=SeedADMNAAA1/u);

    await expect(auditRows(page)).toHaveCount(
      REPORTING_AUDIT.singleDayAdminTargetIds.length
    );
    await expect(auditTargetIds(page)).resolves.toEqual([
      ...REPORTING_AUDIT.singleDayAdminTargetIds,
    ]);

    // The combobox offers the tenant's staff, and the member who made the
    // failed entries holds no tenant role. Their public_id still filters
    // through the URL.
    await page.goto(
      auditLogsUrl({
        actor: SEED_MEMBER_PUBLIC_ID,
        from: REPORTING_AUDIT.from,
        to: REPORTING_AUDIT.to,
      })
    );
    await expect(auditRows(page)).toHaveCount(
      REPORTING_AUDIT.memberTargetIds.length
    );
    await expect(auditTargetIds(page)).resolves.toEqual([
      ...REPORTING_AUDIT.memberTargetIds,
    ]);
    await Promise.all(
      REPORTING_AUDIT.memberTargetIds.map((targetId) =>
        expect(auditRow(page, targetId)).toContainText("Failure")
      )
    );
  });

  test("a malformed filter value in the URL falls back to the default view", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/audit-logs");

    // An action the select never offers, a day February does not have, and a
    // string that is not a date at all. `search-params.ts` maps each to the
    // "no filter" value, so the screen renders its first page instead of an
    // error.
    await page.goto(
      auditLogsUrl({
        action: "drop_everything",
        from: "2026-02-30",
        to: "yesterday",
      })
    );

    await expect(auditEntryRows(page)).toHaveCount(AUDIT_PAGE_SIZE);
    await expect(page.getByText("One of the filters is not valid")).toHaveCount(
      0
    );
    await expect(page.getByText("Could not display the audit log")).toHaveCount(
      0
    );

    const form = auditFilterForm(page);
    await expect(form.action).toHaveValue("");
    await expect(form.from).toHaveValue("");
    await expect(form.to).toHaveValue("");

    // The same key repeated with conflicting values is ambiguous rather than
    // a list, and falls back the same way.
    await page.goto(
      adminUrl(
        `/audit-logs?from=${REPORTING_AUDIT.from}&from=${REPORTING_AUDIT.to}&to=${REPORTING_AUDIT.to}`
      )
    );
    await expect(form.from).toHaveValue("");
    await expect(form.to).toHaveValue(REPORTING_AUDIT.to);
  });

  test("the audit log never shows another tenant's entries", async ({
    page,
  }) => {
    const januaryRange = { from: "2026-01-01", to: "2026-01-31" };

    // The seed tenant's console: its own entries, none of the Boundary
    // Tenant's, and no way to reach them by naming their actor.
    await signInAsSeedAdmin(page, "/audit-logs");
    await page.goto(auditLogsUrl(januaryRange));
    await expect(auditRows(page)).toHaveCount(AUDIT_PAGE_SIZE);
    await expect(auditRows(page, BOUNDARY_AUDIT.targetIdPrefix)).toHaveCount(0);

    await page.goto(
      auditLogsUrl({ ...januaryRange, actor: BOUNDARY_ADMIN.publicId })
    );
    await expect(
      page.getByText("No audit log entry matches these filters.")
    ).toBeVisible();
    await expect(auditRows(page, BOUNDARY_AUDIT.targetIdPrefix)).toHaveCount(0);

    // The Boundary Tenant's own console: the other way round.
    await signInAsAdmin(
      page,
      BOUNDARY_ADMIN,
      "/audit-logs",
      WEB_ADMIN_OTHER_TENANT_BASE_URL
    );
    await page.goto(
      `${WEB_ADMIN_OTHER_TENANT_BASE_URL}/audit-logs?${new URLSearchParams(januaryRange).toString()}`
    );
    await expect(auditRows(page, BOUNDARY_AUDIT.targetIdPrefix)).toHaveCount(
      BOUNDARY_AUDIT.count
    );
    await expect(auditRows(page)).toHaveCount(0);
    await expect(
      auditRow(page, `${BOUNDARY_AUDIT.targetIdPrefix}001`)
    ).toContainText(BOUNDARY_ADMIN.name);
  });

  test("the audit log pages through with a cursor", async ({ page }) => {
    await signInAsSeedAdmin(page, "/audit-logs");
    await page.goto(
      auditLogsUrl({ from: REPORTING_AUDIT.from, to: REPORTING_AUDIT.to })
    );

    await expect(auditRows(page)).toHaveCount(AUDIT_PAGE_SIZE);
    await expect(auditPageLink(page, "Previous")).toHaveCount(0);
    const firstPage = await auditTargetIds(page);
    expect(firstPage[0]).toBe(REPORTING_AUDIT.newestTargetId);

    await moveAuditPage(page, "Next");
    // The filters ride along with the cursor.
    await expect(page).toHaveURL(/[?&]token=/u);
    await expect(page).toHaveURL(/[?&]from=2026-01-05/u);
    await expect(auditRows(page)).toHaveCount(AUDIT_PAGE_SIZE);
    const secondPage = await auditTargetIds(page);
    expect(secondPage.filter((id) => firstPage.includes(id))).toEqual([]);

    await moveAuditPage(page, "Next");
    await expect(auditRows(page)).toHaveCount(
      REPORTING_AUDIT.count - 2 * AUDIT_PAGE_SIZE
    );
    const lastPage = await auditTargetIds(page);
    expect(lastPage.at(-1)).toBe(REPORTING_AUDIT.oldestTargetId);
    expect(lastPage.filter((id) => secondPage.includes(id))).toEqual([]);
    await expect(auditPageLink(page, "Next")).toHaveCount(0);

    // Every seeded entry was reachable across the three pages.
    expect(new Set([...firstPage, ...secondPage, ...lastPage]).size).toBe(
      REPORTING_AUDIT.count
    );

    // `Previous` walks back to the same rows, not to a shifted window.
    await moveAuditPage(page, "Previous");
    await expect.poll(() => auditTargetIds(page)).toEqual(secondPage);

    await moveAuditPage(page, "Previous");
    await expect.poll(() => auditTargetIds(page)).toEqual(firstPage);
    await expect(auditPageLink(page, "Previous")).toHaveCount(0);
  });

  test("the read-through report shows the figures for its period", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/engagement");
    await expect(
      page.getByRole("heading", { name: "Read-through" }).first()
    ).toBeVisible();

    // The period is the tenant's 28 days ending yesterday. What lies outside it —
    // a row dated tomorrow, a row dated 40 days back, both with figures that
    // would swamp these — is not in the totals, and neither is the Boundary
    // Tenant's episode.
    await expect(page.getByText(expectedPeriodText())).toBeVisible();
    await expect(summaryValue(page, "Completions")).toHaveText(
      String(REPORTING_READ_THROUGH.totalCompleteCount)
    );
    await expect(summaryValue(page, "Member views")).toHaveText(
      String(REPORTING_READ_THROUGH.totalMemberViewCount)
    );
    await expect(summaryValue(page, "Read-through rate")).toHaveText(
      REPORTING_READ_THROUGH.totalRate
    );
    await expect(
      readThroughRow(page, REPORTING_READ_THROUGH.boundaryEpisodeTitle)
    ).toHaveCount(0);

    // Highest completions first, and an episode's row sums its days.
    const { first, last } = REPORTING_READ_THROUGH.firstPage;
    await expect(readThroughRows(page)).toHaveCount(READ_THROUGH_PAGE_SIZE);
    await expect(readThroughRows(page).first()).toContainText(
      first.seriesTitle
    );
    await expect(readThroughRows(page).first()).toContainText(
      first.episodeTitle
    );
    await expectReadThroughRow(readThroughRow(page, first.episodeTitle), first);
    await expectReadThroughRow(readThroughRow(page, last.episodeTitle), last);

    const { fullyRead } = REPORTING_READ_THROUGH;
    await expectReadThroughRow(
      readThroughRow(page, fullyRead.episodeTitle),
      fullyRead
    );
  });

  test("the read-through report pages through with a cursor", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page, "/engagement");
    const { firstPage, secondPage } = REPORTING_READ_THROUGH;

    await expect(readThroughRows(page)).toHaveCount(READ_THROUGH_PAGE_SIZE);
    await expect(
      readThroughPagination(page).getByRole("link", { name: "Previous" })
    ).toHaveCount(0);

    await readThroughPagination(page)
      .getByRole("link", { name: "Next" })
      .click();
    await expect(page).toHaveURL(/\?token=/u);
    await expect(
      readThroughRow(page, secondPage.first.episodeTitle)
    ).toBeVisible();
    await expect(readThroughRows(page)).toHaveCount(secondPage.count);
    await expect(readThroughRow(page, firstPage.last.episodeTitle)).toHaveCount(
      0
    );
    await expectReadThroughRow(
      readThroughRow(page, secondPage.first.episodeTitle),
      secondPage.first
    );
    await expectReadThroughRow(
      readThroughRow(page, secondPage.last.episodeTitle),
      secondPage.last
    );
    await expect(
      readThroughPagination(page).getByRole("link", { name: "Next" })
    ).toHaveCount(0);

    // The totals are the period's, not the page's.
    await expect(summaryValue(page, "Completions")).toHaveText(
      String(REPORTING_READ_THROUGH.totalCompleteCount)
    );

    await readThroughPagination(page)
      .getByRole("link", { name: "Previous" })
      .click();
    await expect(
      readThroughRow(page, firstPage.first.episodeTitle)
    ).toBeVisible();
    await expect(readThroughRows(page)).toHaveCount(READ_THROUGH_PAGE_SIZE);
    await expect(
      readThroughRow(page, secondPage.first.episodeTitle)
    ).toHaveCount(0);
  });
});
