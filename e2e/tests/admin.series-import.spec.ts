import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

import { signInAsSeedAdmin } from "../src/admin";
import { deleteSeriesByPublicIds } from "../src/db";
import { uniqueSuffix } from "../src/scenarios/admin-publish";
import { EYE_CATCH_ASPECT_FIXTURES } from "../src/scenarios/eye-catch";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

/**
 * The import from a ZIP, end to end: the check in the browser, the route, and
 * the same RPCs a manual import calls, read back off the console's own screens.
 */

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

const pageImage = readFileSync(EYE_CATCH_ASPECT_FIXTURES.portrait);

/** A manifest as a test writes it. */
interface Manifest {
  episodes: { pages: string[]; title: string }[];
  series: { reading_direction?: string; synopsis?: string; title: string };
  version: number;
}

const importZip = (manifest: Manifest) => ({
  buffer: Buffer.from(
    zipSync({
      "ep01/001.jpg": pageImage,
      "ep01/002.jpg": pageImage,
      "ep02/001.jpg": pageImage,
      "publira-import.json": strToU8(JSON.stringify(manifest)),
    })
  ),
  mimeType: "application/zip",
  name: "import.zip",
});

const pickZip = async (page: Page, manifest: Manifest): Promise<void> => {
  await page.getByRole("button", { name: "Import from a ZIP" }).click();
  await page.getByLabel("ZIP file").setInputFiles(importZip(manifest));
};

/** Reads the audit log until an entry for `action` appears. */
const expectAuditEntry = async (page: Page, action: string): Promise<void> => {
  // The entry is written by the audit log's asynchronous recorder.
  await expect(async () => {
    await page.goto(adminUrl("/audit-logs"));
    await expect(
      page.getByRole("row").filter({ hasText: action }).first()
    ).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 30_000 });
};

test.describe("web-admin series import from a ZIP", () => {
  let createdSeriesIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    await signInAsSeedAdmin(page, "/series");
  });

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    createdSeriesIds = [];
  });

  test("creates the series and both episodes with their pages in order, as drafts", async ({
    page,
  }) => {
    test.slow();

    const title = `Imported series ${uniqueSuffix()}`;

    await pickZip(page, {
      episodes: [
        { pages: ["ep01/001.jpg", "ep01/002.jpg"], title: "Imported one" },
        { pages: ["ep02/001.jpg"], title: "Imported two" },
      ],
      series: { reading_direction: "ltr", synopsis: "From a ZIP", title },
      version: 1,
    });

    await expect(
      page.getByText(`Ready to create the series ${title} with 2 episodes.`)
    ).toBeVisible();
    await page.getByRole("button", { exact: true, name: "Import" }).click();

    await expect(page.getByText("Imported 2 episodes.")).toBeVisible({
      timeout: 120_000,
    });

    const rows = page.getByRole("dialog").getByRole("row");

    await expect(rows.filter({ hasText: "Imported one" })).toContainText("2");
    await expect(rows.filter({ hasText: "Imported two" })).toContainText("1");

    await page.getByRole("link", { name: "Open the series' episodes" }).click();
    await page.waitForURL(/\/series\/(?<id>[^/]+)\/episodes$/u);

    const seriesId = /\/series\/(?<id>[^/]+)\/episodes$/u.exec(page.url())
      ?.groups?.id;

    createdSeriesIds.push(seriesId ?? "");

    await expect(page.getByText("2. Imported two")).toBeVisible();
    await expect(page.getByText("1. Imported one")).toBeVisible();
    await page.getByRole("link", { exact: true, name: "Edit" }).first().click();

    await expect(
      page
        .getByRole("list", { exact: true, name: "Registered page images" })
        .getByRole("listitem")
    ).toHaveCount(2);

    await expectAuditEntry(page, "Series created");
    await expectAuditEntry(page, "Episode created");
    await expectAuditEntry(page, "Episode body image uploaded");
  });

  test("refuses a manifest naming a page not in the ZIP before anything is sent", async ({
    page,
  }) => {
    let sent = false;

    page.on("request", (request) => {
      sent ||= new URL(request.url()).pathname === "/api/v1/series-import";
    });

    await pickZip(page, {
      episodes: [{ pages: ["ep01/404.jpg"], title: "Imported one" }],
      series: { title: `Refused series ${uniqueSuffix()}` },
      version: 1,
    });

    await expect(
      page.getByText("Imported one: ep01/404.jpg is not in the ZIP.")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { exact: true, name: "Import" })
    ).toBeDisabled();
    expect(sent).toBe(false);
  });
});
