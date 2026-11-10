import { expect, test } from "@playwright/test";

import {
  createEpisodeViaUi,
  createSeriesViaUi,
  signInAsAdmin,
  signInAsSeedAdmin,
} from "../src/admin";
import { applyScenarioSql, deleteSeriesByPublicIds } from "../src/db";
import { uniqueSuffix } from "../src/scenarios/admin-publish";
import {
  TENANT_ROLES_EDITOR,
  TENANT_ROLES_SCENARIO,
} from "../src/scenarios/tenant-roles";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

/** The seed series, which no test here deletes. */
const SEED_SERIES_PATH = "/series/SeedSERSAAA1";

/**
 * Deleting a series from the end of its screen: a Tenant admin deletes one
 * that holds nothing by typing its title, a refused deletion keeps the dialog
 * open with the reason and the screen that holds it, and an Editor is offered
 * no control at all.
 */
test.describe("admin series deletion", () => {
  let createdSeriesIds: string[] = [];

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    createdSeriesIds = [];
  });

  test("deletes a series that holds nothing once its title is typed", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page);

    const title = `E2E Series Deletion ${uniqueSuffix()}`;

    const seriesId = await createSeriesViaUi(page, {
      synopsis: `E2E series deletion synopsis for ${title}`,
      title,
    });

    // Cleaned up if the deletion under test fails.
    createdSeriesIds.push(seriesId);

    await page.goto(`${WEB_ADMIN_BASE_URL}/series/${seriesId}`);
    await page.getByRole("button", { name: "Delete this series" }).click();

    const dialog = page.getByRole("dialog", { name: `Delete “${title}”?` });
    const confirm = dialog.getByRole("button", { name: "Delete series" });

    await expect(confirm).toBeDisabled();
    await dialog
      .getByRole("textbox", { name: /Enter the series' title to confirm/u })
      .fill(title);
    await confirm.click();

    await page.waitForURL((url) => url.pathname === "/series");
    await expect(page.getByText(`“${title}” was deleted.`)).toBeVisible();
    await expect(page.getByRole("link", { name: title })).toHaveCount(0);

    await page.goto(`${WEB_ADMIN_BASE_URL}/series/${seriesId}`);
    await expect(
      page.getByRole("heading", { name: "Page not found" })
    ).toBeVisible();
  });

  test("keeps a series with an episode and says why", async ({ page }) => {
    await signInAsSeedAdmin(page);

    const suffix = uniqueSuffix();
    const title = `E2E Series Deletion Refusal ${suffix}`;

    const seriesId = await createSeriesViaUi(page, {
      synopsis: `E2E series deletion refusal synopsis ${suffix}`,
      title,
    });

    createdSeriesIds.push(seriesId);

    await createEpisodeViaUi(page, {
      seriesPublicId: seriesId,
      title: `E2E Series Deletion Refusal Episode ${suffix}`,
    });

    const editPath = `/series/${seriesId}`;

    await page.goto(`${WEB_ADMIN_BASE_URL}${editPath}`);
    await page.getByRole("button", { name: "Delete this series" }).click();

    const dialog = page.getByRole("dialog", { name: `Delete “${title}”?` });

    await dialog
      .getByRole("textbox", { name: /Enter the series' title to confirm/u })
      .fill(title);
    await dialog.getByRole("button", { name: "Delete series" }).click();

    await expect(
      dialog.getByText(
        "This series cannot be deleted while it has episodes. Delete each of them first, or take the series off the site instead."
      )
    ).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: "View its episodes" })
    ).toHaveAttribute("href", `/series/${seriesId}/episodes`);
    expect(new URL(page.url()).pathname).toBe(editPath);

    // The series is still there once the dialog is closed.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Delete this series" })
    ).toBeVisible();
  });

  test("offers an editor no deletion", async ({ page }) => {
    applyScenarioSql(TENANT_ROLES_SCENARIO);
    await signInAsAdmin(page, TENANT_ROLES_EDITOR, SEED_SERIES_PATH);

    // The page has finished streaming once it has loaded, so every section
    // the editor is shown has arrived by then.
    await page.goto(`${WEB_ADMIN_BASE_URL}${SEED_SERIES_PATH}`, {
      waitUntil: "load",
    });
    await expect(
      page.getByRole("heading", { name: "Free after publication" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete this series" })
    ).toHaveCount(0);
  });
});
