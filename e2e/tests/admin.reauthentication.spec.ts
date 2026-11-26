import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { SEED_ADMIN } from "../src/scenarios/admin-publish";
import { fillLoginForm } from "../src/session";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

/**
 * A change a session someone else got hold of could do the most harm with —
 * here, issuing an API key — asks the operator to confirm it's them even
 * while they are signed in: a wrong password changes nothing, the right one
 * makes the change as it was submitted, and the next such change in the same
 * session does not ask again.
 *
 * The page signs in through the form rather than `signInAsAdmin`, which
 * answers the dialog by itself for every other suite.
 */

const PAGE_PATH = "/integrations/api-keys-and-webhooks";

const keysSection = (page: Page) =>
  page
    .getByRole("main")
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        exact: true,
        level: 2,
        name: "API keys",
      }),
    })
    .last();

const submitKey = async (page: Page, name: string): Promise<void> => {
  const keys = keysSection(page);
  await keys.getByLabel("Name").fill(name);
  await keys.getByRole("checkbox", { exact: true, name: "Catalog" }).check();
  await keys.getByRole("button", { name: "Create API key" }).click();
};

test("asks the operator to confirm it's them before an API key is issued, and not again for a while", async ({
  page,
}) => {
  await page.goto(
    `${WEB_ADMIN_BASE_URL}/login?next=${encodeURIComponent(PAGE_PATH)}`
  );
  await fillLoginForm(page, SEED_ADMIN);
  await page.waitForURL((url) => url.pathname === PAGE_PATH);

  const keys = keysSection(page);
  const first = `Confirmed ${randomUUID().slice(0, 8)}`;
  const second = `Confirmed ${randomUUID().slice(0, 8)}`;

  await submitKey(page, first);

  const dialog = page.getByRole("dialog", { name: "Confirm it's you" });
  await expect(dialog).toBeVisible();
  // The modal dialog hides the screen behind it from the accessibility tree,
  // so the refused form's message is found by its text alone.
  await expect(
    page.getByText("Confirm it's you to make this change.")
  ).toBeVisible();

  const password = dialog.locator('input[name="password"]');
  await password.fill("not-the-password");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(
    dialog.getByText("The password is not correct.").first()
  ).toBeVisible();

  await password.fill(SEED_ADMIN.password);
  await dialog.getByRole("button", { name: "Continue" }).click();

  // The refused form goes out again as it was filled in.
  await expect(dialog).toBeHidden();
  await expect(keys.getByText("Your new API key")).toBeVisible();
  await expect(keys.getByRole("row").filter({ hasText: first })).toBeVisible();

  await submitKey(page, second);

  await expect(keys.getByRole("row").filter({ hasText: second })).toBeVisible();
  await expect(dialog).toBeHidden();
});
