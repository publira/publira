import { expect, test } from "@playwright/test";

import {
  createCreatorViaUi,
  signInAsAdmin,
  signInAsSeedAdmin,
} from "../src/admin";
import { applyScenarioSql, deleteCreatorsByPublicIds } from "../src/db";
import { SEED_CATALOG, uniqueSuffix } from "../src/scenarios/admin-publish";
import {
  TENANT_ROLES_EDITOR,
  TENANT_ROLES_SCENARIO,
} from "../src/scenarios/tenant-roles";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

/** The seed Author, whom the seed series credits and no test here deletes. */
const SEED_CREATOR_PATH = `/creators/${SEED_CATALOG.creatorPublicId}`;

/**
 * Deleting an Author from the end of their screen: a Tenant admin deletes one
 * that nothing refers to by typing their name, a refused deletion keeps the
 * dialog open with the reason and a link to the series list, and an Editor is
 * offered no control at all.
 */
test.describe("admin author deletion", () => {
  let createdCreatorIds: string[] = [];

  test.afterEach(() => {
    deleteCreatorsByPublicIds(createdCreatorIds);
    createdCreatorIds = [];
  });

  test("deletes an author nothing refers to once their name is typed", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page);

    const name = `E2E Author Deletion ${uniqueSuffix()}`;
    const creatorPublicId = await createCreatorViaUi(page, { name });

    // Cleaned up if the deletion under test fails.
    createdCreatorIds.push(creatorPublicId);

    await page.goto(`${WEB_ADMIN_BASE_URL}/creators/${creatorPublicId}`);
    await page.getByRole("button", { name: "Delete this author" }).click();

    const dialog = page.getByRole("dialog", { name: `Delete “${name}”?` });
    const confirm = dialog.getByRole("button", { name: "Delete author" });

    await expect(confirm).toBeDisabled();
    await dialog
      .getByRole("textbox", { name: /Enter the author's name to confirm/u })
      .fill(name);
    await confirm.click();

    await page.waitForURL((url) => url.pathname === "/creators");
    await expect(page.getByText(`“${name}” was deleted.`)).toBeVisible();
    await expect(page.getByRole("cell", { name })).toHaveCount(0);

    await page.goto(`${WEB_ADMIN_BASE_URL}/creators/${creatorPublicId}`);
    await expect(
      page.getByRole("heading", { name: "Page not found" })
    ).toBeVisible();
  });

  test("keeps a credited author and links to the series list", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page);

    await page.goto(`${WEB_ADMIN_BASE_URL}${SEED_CREATOR_PATH}`);
    await page.getByRole("button", { name: "Delete this author" }).click();

    const name = SEED_CATALOG.creatorName;
    const dialog = page.getByRole("dialog", { name: `Delete “${name}”?` });

    await dialog
      .getByRole("textbox", { name: /Enter the author's name to confirm/u })
      .fill(name);
    await dialog.getByRole("button", { name: "Delete author" }).click();

    await expect(
      dialog.getByText(
        "This author cannot be deleted while a series or an episode credits them. Remove them from the Authors of each series and episode that credits them first."
      )
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(SEED_CREATOR_PATH);

    await dialog.getByRole("link", { name: "View series" }).click();
    await page.waitForURL((url) => url.pathname === "/series");

    // The Author is still there.
    await page.goto(`${WEB_ADMIN_BASE_URL}${SEED_CREATOR_PATH}`);
    await expect(
      page.getByRole("button", { name: "Delete this author" })
    ).toBeVisible();
  });

  test("offers an editor no deletion", async ({ page }) => {
    applyScenarioSql(TENANT_ROLES_SCENARIO);
    await signInAsAdmin(page, TENANT_ROLES_EDITOR, SEED_CREATOR_PATH);

    // The page has finished streaming once it has loaded, so every section
    // the editor is shown has arrived by then.
    await page.goto(`${WEB_ADMIN_BASE_URL}${SEED_CREATOR_PATH}`, {
      waitUntil: "load",
    });
    await expect(
      page.getByRole("button", { name: "Update author" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete this author" })
    ).toHaveCount(0);
  });
});
