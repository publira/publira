import { expect, test } from "@playwright/test";

import {
  createLabelViaUi,
  createSeriesViaUi,
  signInAsAdmin,
  signInAsSeedAdmin,
} from "../src/admin";
import {
  applyScenarioSql,
  deleteLabelsByPublicIds,
  deleteSeriesByPublicIds,
} from "../src/db";
import { SEED_CATALOG, uniqueSuffix } from "../src/scenarios/admin-publish";
import {
  TENANT_ROLES_EDITOR,
  TENANT_ROLES_SCENARIO,
} from "../src/scenarios/tenant-roles";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

/** The seed label, which no test here deletes. */
const SEED_LABEL_PATH = `/labels/${SEED_CATALOG.labelPublicId}`;

/**
 * Deleting a label from the end of its screen: a Tenant admin deletes one that
 * nothing refers to by typing its name, a refused deletion keeps the dialog
 * open with the reason and a link to the series list narrowed to the label,
 * and an Editor is offered no control at all.
 */
test.describe("admin label deletion", () => {
  let createdSeriesIds: string[] = [];
  let createdLabelIds: string[] = [];

  test.afterEach(() => {
    // A series names its label, so it goes first.
    deleteSeriesByPublicIds(createdSeriesIds);
    deleteLabelsByPublicIds(createdLabelIds);
    createdSeriesIds = [];
    createdLabelIds = [];
  });

  test("deletes a label nothing refers to once its name is typed", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page);

    const name = `E2E Label Deletion ${uniqueSuffix()}`;
    const labelPublicId = await createLabelViaUi(page, name);

    // Cleaned up if the deletion under test fails.
    createdLabelIds.push(labelPublicId);

    await page.goto(`${WEB_ADMIN_BASE_URL}/labels/${labelPublicId}`);
    await page.getByRole("button", { name: "Delete this label" }).click();

    const dialog = page.getByRole("dialog", { name: `Delete “${name}”?` });
    const confirm = dialog.getByRole("button", { name: "Delete label" });

    await expect(confirm).toBeDisabled();
    await dialog
      .getByRole("textbox", { name: /Enter the label's name to confirm/u })
      .fill(name);
    await confirm.click();

    await page.waitForURL((url) => url.pathname === "/labels");
    await expect(page.getByText(`“${name}” was deleted.`)).toBeVisible();
    await expect(page.getByRole("cell", { name })).toHaveCount(0);

    await page.goto(`${WEB_ADMIN_BASE_URL}/labels/${labelPublicId}`);
    await expect(
      page.getByRole("heading", { name: "Page not found" })
    ).toBeVisible();
  });

  test("keeps a label a series is filed under and links to its series", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page);

    const suffix = uniqueSuffix();
    const name = `E2E Label Deletion Refusal ${suffix}`;
    const title = `E2E Label Deletion Refusal Series ${suffix}`;
    const labelPublicId = await createLabelViaUi(page, name);

    createdLabelIds.push(labelPublicId);

    const seriesId = await createSeriesViaUi(page, {
      labelName: name,
      synopsis: `E2E label deletion refusal synopsis ${suffix}`,
      title,
    });

    createdSeriesIds.push(seriesId);

    const editPath = `/labels/${labelPublicId}`;

    await page.goto(`${WEB_ADMIN_BASE_URL}${editPath}`);
    await page.getByRole("button", { name: "Delete this label" }).click();

    const dialog = page.getByRole("dialog", { name: `Delete “${name}”?` });

    await dialog
      .getByRole("textbox", { name: /Enter the label's name to confirm/u })
      .fill(name);
    await dialog.getByRole("button", { name: "Delete label" }).click();

    await expect(
      dialog.getByText(
        "This label cannot be deleted while a series is filed under it. Move each of its series to another label first."
      )
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(editPath);

    // The link opens the series list narrowed to the label: its one series,
    // and none of the seed's.
    await dialog.getByRole("link", { name: "View its series" }).click();
    await page.waitForURL((url) => url.pathname === "/series");
    expect(new URL(page.url()).searchParams.get("label_id")).not.toBe("");
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(2);

    // The label is still there.
    await page.goto(`${WEB_ADMIN_BASE_URL}${editPath}`);
    await expect(
      page.getByRole("button", { name: "Delete this label" })
    ).toBeVisible();
  });

  test("offers an editor no deletion", async ({ page }) => {
    applyScenarioSql(TENANT_ROLES_SCENARIO);
    await signInAsAdmin(page, TENANT_ROLES_EDITOR, SEED_LABEL_PATH);

    // The page has finished streaming once it has loaded, so every section
    // the editor is shown has arrived by then.
    await page.goto(`${WEB_ADMIN_BASE_URL}${SEED_LABEL_PATH}`, {
      waitUntil: "load",
    });
    await expect(
      page.getByRole("button", { name: "Update label" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete this label" })
    ).toHaveCount(0);
  });
});
