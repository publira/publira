import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  createPageViaUi,
  signInAsAdmin,
  signInAsSeedAdmin,
} from "../src/admin";
import { applyScenarioSql, deletePagesByIds } from "../src/db";
import { uniqueSuffix } from "../src/scenarios/admin-publish";
import {
  TENANT_ROLES_EDITOR,
  TENANT_ROLES_SCENARIO,
} from "../src/scenarios/tenant-roles";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

const editorUrl = (pageId: string): string =>
  `${WEB_ADMIN_BASE_URL}/pages/${pageId}`;

/** Open the dialog that deletes the page and type `slug` into it. */
const openDeleteDialog = async (page: Page, title: string, slug: string) => {
  await page.getByRole("button", { name: "Delete this page" }).click();

  const dialog = page.getByRole("dialog", { name: `Delete “${title}”?` });
  const confirm = dialog.getByRole("button", { name: "Delete page" });

  await expect(confirm).toBeDisabled();
  await dialog
    .getByRole("textbox", { name: /Enter the page's slug, .+, to confirm/u })
    .fill(slug);

  return { confirm, dialog };
};

/**
 * Deleting a page from the end of its edit screen: a Tenant admin deletes an
 * unpublished one by typing its slug, a deletion refused because the page was
 * published meanwhile keeps the dialog open with the reason and a link to the
 * translation's Unpublish, and an Editor is offered no control at all.
 */
test.describe("admin page deletion", () => {
  let createdPageIds: string[] = [];

  test.afterEach(() => {
    deletePagesByIds(createdPageIds);
    createdPageIds = [];
  });

  test("deletes an unpublished page once its slug is typed", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page);

    const suffix = uniqueSuffix();
    const title = `E2E Page Deletion ${suffix}`;
    const slug = `e2e-page-deletion-${suffix}`;
    const pageId = await createPageViaUi(page, { slug, title });

    // Cleaned up if the deletion under test fails.
    createdPageIds.push(pageId);

    const { confirm } = await openDeleteDialog(page, title, slug);
    await confirm.click();

    await page.waitForURL((url) => url.pathname === "/pages");
    await expect(page.getByText(`“${title}” was deleted.`)).toBeVisible();
    await expect(page.getByRole("cell", { name: title })).toHaveCount(0);

    await page.goto(editorUrl(pageId));
    await expect(
      page.getByRole("heading", { name: "Page not found" })
    ).toBeVisible();
  });

  test("keeps a page published behind the dialog and links to its Unpublish", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page);

    const suffix = uniqueSuffix();
    const title = `E2E Page Deletion Published ${suffix}`;
    const slug = `e2e-page-deletion-published-${suffix}`;

    const pageId = await createPageViaUi(page, {
      body: { text: "Published while the dialog is open." },
      slug,
      title,
    });

    createdPageIds.push(pageId);

    const { confirm, dialog } = await openDeleteDialog(page, title, slug);

    // Someone else publishes the page while the dialog is open.
    const other = await page.context().newPage();
    await other.goto(editorUrl(pageId));
    await other
      .getByRole("row")
      .filter({ has: other.getByRole("cell", { exact: true, name: "v1" }) })
      .getByRole("button", { name: "Publish" })
      .click();
    await expect(
      other.getByRole("button", { name: "Unpublish" })
    ).toBeVisible();
    await other.close();

    await confirm.click();

    await expect(
      dialog.getByText(
        "This page cannot be deleted while it is published. Unpublish each translation that is published first."
      )
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/pages/${pageId}`);

    await dialog
      .getByRole("link", { name: "Open the published translation" })
      .click();
    await expect(page.getByRole("button", { name: "Unpublish" })).toBeVisible();
  });

  test("offers an editor no deletion", async ({ browser, page }) => {
    await signInAsSeedAdmin(page);

    const suffix = uniqueSuffix();

    const pageId = await createPageViaUi(page, {
      slug: `e2e-page-deletion-editor-${suffix}`,
      title: `E2E Page Deletion Editor ${suffix}`,
    });

    createdPageIds.push(pageId);

    // The Tenant admin is offered the control on this page.
    await expect(
      page.getByRole("button", { name: "Delete this page" })
    ).toBeVisible();

    applyScenarioSql(TENANT_ROLES_SCENARIO);

    const editorContext = await browser.newContext();
    const editor = await editorContext.newPage();
    await signInAsAdmin(editor, TENANT_ROLES_EDITOR, `/pages/${pageId}`);

    // The page has finished streaming once it has loaded, so every section
    // the editor is shown has arrived by then.
    await editor.goto(editorUrl(pageId), { waitUntil: "load" });
    await expect(
      editor.getByRole("button", { name: "Save page" })
    ).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "Delete this page" })
    ).toHaveCount(0);

    await editorContext.close();
  });
});
