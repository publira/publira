import "temporal-polyfill/global";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { Download, Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  signInAsPlatformOperator,
  signInAsSeedPlatformSuperAdmin,
} from "../src/platform";
import {
  PLATFORM_AUDIT_LOG_EXPORT_AUDITOR,
  PLATFORM_AUDIT_LOG_EXPORT_OPERATOR,
  PLATFORM_AUDIT_LOG_EXPORT_SCENARIO,
  PLATFORM_AUDIT_LOG_EXPORT_WEEK,
} from "../src/scenarios/platform-audit-log-export";
import { WEB_PLATFORM_BASE_URL } from "../src/urls";

/** Every locale the console ships, as `locales/index.json` registers them. */
const LOCALES: readonly string[] = (
  JSON.parse(
    readFileSync(new URL("../../locales/index.json", import.meta.url), "utf-8")
  ) as { locales: { code: string }[] }
).locales.map(({ code }) => code);

/** A phone, the narrowest tablet held upright, and the desktop the suite runs at. */
const WIDTHS = [390, 744, 1280];

/**
 * Open the action filter until `option` shows. The trigger is pressed again
 * only while the list is still closed, since the first click can land before
 * the filter has hydrated.
 */
const openActions = async (
  trigger: Locator,
  option: Locator
): Promise<void> => {
  await expect(async () => {
    if (!(await option.isVisible())) {
      await trigger.click();
    }

    await expect(option).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
};

/**
 * How far the name in the trigger runs into its padding on each side, and
 * past the right edge of the screen: zero or less everywhere when it fits.
 */
const overflow = (trigger: Locator) =>
  trigger.evaluate((element) => {
    const value = element.firstElementChild;

    if (!value) {
      throw new TypeError("The action filter shows no value.");
    }

    const styles = element.computedStyleMap();

    const inset = (side: "bottom" | "left" | "right" | "top"): number => {
      const border = styles.get(`border-${side}-width`);
      const padding = styles.get(`padding-${side}`);

      return (
        (border instanceof CSSUnitValue ? border.value : 0) +
        (padding instanceof CSSUnitValue ? padding.value : 0)
      );
    };

    const box = element.getBoundingClientRect();
    const text = value.getBoundingClientRect();

    return Math.max(
      text.bottom - (box.bottom - inset("bottom")),
      box.left + inset("left") - text.left,
      text.right - (box.right - inset("right")),
      box.top + inset("top") - text.top,
      box.right - document.documentElement.clientWidth
    );
  });

/**
 * Choose each action from `index` on in turn and check its name fits.
 *
 * Recursion rather than a loop: every step drives the one select, so the
 * choices cannot be made together.
 */
const expectEachActionFits = async (
  page: Page,
  trigger: Locator,
  index: number,
  count: number
): Promise<void> => {
  if (index >= count) {
    return;
  }

  const option = page.getByRole("option").nth(index);
  await openActions(trigger, option);
  const text = await option.textContent();
  const label = text?.trim() ?? "";
  await option.click();
  await expect(option).toBeHidden();
  await expect(trigger).toHaveText(label);

  expect(await overflow(trigger), label).toBeLessThanOrEqual(0.5);

  await expectEachActionFits(page, trigger, index + 1, count);
};

/**
 * The action filter of the audit log names an action in a phrase that runs
 * from two words to a sentence, so every name it offers is chosen in turn,
 * in every locale and at every width the console is laid out for, to see that
 * none of them spills out of the trigger.
 */
test.describe("web-platform audit log action filter", () => {
  // Each case only reads, and walking every action is slow enough that the
  // fifteen of them in order would hold one worker, and one shard, for minutes.
  test.describe.configure({ mode: "parallel" });

  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      test(`fits every action name in ${locale} at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ height: 900, width });
        await signInAsSeedPlatformSuperAdmin(page, "/audit-logs");
        await page.context().addCookies([
          {
            name: "publira_locale",
            url: WEB_PLATFORM_BASE_URL,
            value: locale,
          },
        ]);
        await page.goto(`${WEB_PLATFORM_BASE_URL}/audit-logs`);

        const trigger = page.getByRole("main").getByRole("combobox");
        await openActions(trigger, page.getByRole("option").first());
        const count = await page.getByRole("option").count();
        await page.keyboard.press("Escape");
        // An option stays visible while the list fades out, and would pass for
        // an open list in the first step below.
        await expect(page.getByRole("option").first()).toBeHidden();

        await expectEachActionFits(page, trigger, 0, count);
      });
    }
  }
});

const auditLogsUrl = (query: Record<string, string>): string =>
  `${WEB_PLATFORM_BASE_URL}/audit-logs?${new URLSearchParams(query)}`;

const auditRows = (page: Page): Locator => page.locator("table tbody tr");

const downloadLink = (page: Page): Locator =>
  page.getByRole("link", { exact: true, name: "Download CSV" });

/** Clicks **Download CSV** and waits for the file it saves. */
const downloadAuditCsv = async (page: Page): Promise<Download> => {
  const downloading = page.waitForEvent("download");
  await downloadLink(page).click();

  return downloading;
};

/** A downloaded CSV's header and body rows, split on its CRLF endings. */
const csvRows = async (download: Download): Promise<string[]> => {
  const csv = await readFile(await download.path(), "utf-8");

  return csv.split("\r\n").filter((row) => row !== "");
};

/**
 * **Download CSV** on the audit log saves the period and the filters the list
 * shows, for every operator role, an Auditor included, and the download is
 * itself an entry of the log.
 */
test.describe("web-platform audit log download", () => {
  test.beforeAll(() => {
    applyScenarioSql(PLATFORM_AUDIT_LOG_EXPORT_SCENARIO);
  });

  test("an Auditor narrows the list to a week and downloads it", async ({
    page,
  }) => {
    const week = PLATFORM_AUDIT_LOG_EXPORT_WEEK;
    await signInAsPlatformOperator(
      page,
      PLATFORM_AUDIT_LOG_EXPORT_AUDITOR,
      `/audit-logs?${new URLSearchParams({
        actor_user_public_id: PLATFORM_AUDIT_LOG_EXPORT_OPERATOR.publicId,
      })}`
    );
    await expect(auditRows(page)).toHaveCount(week.actions.length + 2);

    await page.getByLabel("From", { exact: true }).fill(week.from);
    await page.getByLabel("To", { exact: true }).fill(week.to);
    await page.getByRole("button", { exact: true, name: "Filter" }).click();
    await page.waitForURL(
      (url) =>
        url.searchParams.get("created_from") === week.from &&
        url.searchParams.get("created_to") === week.to
    );
    await expect(auditRows(page)).toHaveCount(week.actions.length);

    const download = await downloadAuditCsv(page);
    expect(download.suggestedFilename()).toBe(
      `platform-audit-log-${week.from}--${week.to}.csv`
    );
    const [header, ...rows] = await csvRows(download);
    expect(header).toBe(
      "\uFEFFtime,actor_public_id,actor_name,actor_role,action,outcome,reason,target_type,target_id,client_ip,tenant_public_id,tenant_name,target_public_id,target_name"
    );
    // The week's entries oldest first, and none of the two just outside it.
    const columns = rows.map((row) => row.split(","));
    expect(columns.map((cells) => cells[4])).toEqual(week.actions);
    expect(new Set(columns.map((cells) => cells[1]))).toEqual(
      new Set([PLATFORM_AUDIT_LOG_EXPORT_OPERATOR.publicId])
    );

    // The download is an entry of the log itself, written by the same
    // asynchronous recorder as every other one, so the read polls.
    const period = `${week.from}/${week.to}`;
    const exportedRow = auditRows(page).filter({ hasText: period }).first();
    await expect(async () => {
      await page.goto(
        auditLogsUrl({
          action: "audit_log_exported",
          actor_user_public_id: PLATFORM_AUDIT_LOG_EXPORT_AUDITOR.publicId,
        })
      );
      await expect(exportedRow).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 30_000 });
    await expect(exportedRow).toContainText("Downloaded the audit log as CSV");
    await expect(exportedRow).toContainText(
      PLATFORM_AUDIT_LOG_EXPORT_AUDITOR.name
    );
  });

  test("Download CSV is offered only for a period one file can cover", async ({
    page,
  }) => {
    await signInAsSeedPlatformSuperAdmin(page, "/audit-logs");

    // The unfiltered list: the 366 days ending today in the platform's zone,
    // which the development seed sets to UTC.
    const today = Temporal.Now.plainDateISO("UTC");
    await expect(downloadLink(page)).toHaveAttribute(
      "href",
      `/api/v1/audit-logs/csv?${new URLSearchParams({
        created_from: today.subtract({ days: 365 }).toString(),
        created_to: today.toString(),
      })}`
    );

    // A period longer than one file offers no download, and neither does a
    // reversed one.
    const periodNote = page.getByText("Download CSV covers at most 366 days");
    await page.goto(
      auditLogsUrl({ created_from: "2025-01-01", created_to: "2026-01-02" })
    );
    await expect(periodNote).toBeVisible();
    await expect(downloadLink(page)).toHaveCount(0);

    await page.goto(
      auditLogsUrl({ created_from: "2025-03-09", created_to: "2025-03-03" })
    );
    await expect(periodNote).toBeVisible();
    await expect(downloadLink(page)).toHaveCount(0);
  });
});
