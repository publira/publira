import { expect, test } from "@playwright/test";

import {
  createEpisodeViaUi,
  createSeriesViaUi,
  signInAsAdmin,
  signInAsSeedAdmin,
} from "../src/admin";
import {
  applyScenarioSql,
  deleteSeriesByPublicIds,
  quoteSqlLiteral,
  runSql,
} from "../src/db";
import { uniqueSuffix } from "../src/scenarios/admin-publish";
import {
  TENANT_ROLES_EDITOR,
  TENANT_ROLES_SCENARIO,
} from "../src/scenarios/tenant-roles";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

/** An episode of the seed series nobody bought, which no test here deletes. */
const SEED_EPISODE_PATH = "/series/SeedSERSAAA1/episodes/SeedEPSDAAA1";

/**
 * Issues the seed member a ticket to the episode, as staff would from the
 * console. The ticket goes with the episode's series when the test cleans up,
 * since tickets cascade from their episode.
 */
const issueTicketToSeedMember = (episodePublicId: string): void => {
  runSql(`
    INSERT INTO access_tickets (id, tenant_id, public_id, episode_id, user_id, note)
    SELECT gen_random_uuid(), e.tenant_id, ${quoteSqlLiteral(uniqueSuffix())}, e.id, u.id, 'Episode deletion E2E'
    FROM episodes e
    JOIN tenants t ON t.id = e.tenant_id AND t.public_id = 'SeedTNNTAAA1'
    JOIN users u ON u.tenant_id = e.tenant_id AND u.email = 'member@example.com'
    WHERE e.public_id = ${quoteSqlLiteral(episodePublicId)};
  `);
};

/**
 * Deleting an episode from the end of its screen: a Tenant admin deletes one
 * nothing refers to by typing its title, a refused deletion keeps the dialog
 * open with the reason and the list that holds it, and an Editor is offered no
 * control at all.
 */
test.describe("admin episode deletion", () => {
  let createdSeriesIds: string[] = [];

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    createdSeriesIds = [];
  });

  test("deletes an episode nothing refers to once its title is typed", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page);

    const suffix = uniqueSuffix();

    const seriesId = await createSeriesViaUi(page, {
      synopsis: `E2E episode deletion synopsis ${suffix}`,
      title: `E2E Episode Deletion Series ${suffix}`,
    });

    createdSeriesIds.push(seriesId);

    const title = `E2E Episode Deletion ${suffix}`;

    const episodeId = await createEpisodeViaUi(page, {
      seriesPublicId: seriesId,
      title,
    });

    await page.goto(
      `${WEB_ADMIN_BASE_URL}/series/${seriesId}/episodes/${episodeId}`
    );
    await page.getByRole("button", { name: "Delete this episode" }).click();

    const dialog = page.getByRole("dialog", { name: `Delete “${title}”?` });
    const confirm = dialog.getByRole("button", { name: "Delete episode" });

    await expect(confirm).toBeDisabled();
    await dialog
      .getByRole("textbox", { name: /Enter the episode's title to confirm/u })
      .fill(title);
    await confirm.click();

    await page.waitForURL(
      (url) => url.pathname === `/series/${seriesId}/episodes`
    );
    await expect(page.getByText(`“${title}” was deleted.`)).toBeVisible();
    await expect(page.getByRole("link", { name: title })).toHaveCount(0);

    await page.goto(
      `${WEB_ADMIN_BASE_URL}/series/${seriesId}/episodes/${episodeId}`
    );
    await expect(
      page.getByRole("heading", { name: "Page not found" })
    ).toBeVisible();
  });

  test("keeps an episode with an access ticket and says why", async ({
    page,
  }) => {
    await signInAsSeedAdmin(page);

    const suffix = uniqueSuffix();

    const seriesId = await createSeriesViaUi(page, {
      synopsis: `E2E episode deletion refusal synopsis ${suffix}`,
      title: `E2E Episode Deletion Refusal Series ${suffix}`,
    });

    createdSeriesIds.push(seriesId);

    const title = `E2E Episode Deletion Refusal ${suffix}`;

    const episodeId = await createEpisodeViaUi(page, {
      seriesPublicId: seriesId,
      title,
    });

    issueTicketToSeedMember(episodeId);

    const editPath = `/series/${seriesId}/episodes/${episodeId}`;

    await page.goto(`${WEB_ADMIN_BASE_URL}${editPath}`);
    await page.getByRole("button", { name: "Delete this episode" }).click();

    const dialog = page.getByRole("dialog", { name: `Delete “${title}”?` });

    await dialog
      .getByRole("textbox", { name: /Enter the episode's title to confirm/u })
      .fill(title);
    await dialog.getByRole("button", { name: "Delete episode" }).click();

    await expect(
      dialog.getByText(
        "This episode cannot be deleted: an access ticket has been issued for it, counting revoked and expired ones. Take it off the site instead."
      )
    ).toBeVisible();
    await expect(
      dialog.getByRole("link", { name: "View its access tickets" })
    ).toHaveAttribute("href", `/access-tickets?episode=${episodeId}`);
    expect(new URL(page.url()).pathname).toBe(editPath);

    // The episode is still there once the dialog is closed.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Delete this episode" })
    ).toBeVisible();
  });

  test("offers an editor no deletion", async ({ page }) => {
    applyScenarioSql(TENANT_ROLES_SCENARIO);
    await signInAsAdmin(page, TENANT_ROLES_EDITOR, SEED_EPISODE_PATH);

    // The page has finished streaming once it has loaded, so every section
    // the editor is shown has arrived by then.
    await page.goto(`${WEB_ADMIN_BASE_URL}${SEED_EPISODE_PATH}`, {
      waitUntil: "load",
    });
    await expect(
      page.getByRole("heading", { exact: true, name: "Preview" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delete this episode" })
    ).toHaveCount(0);
  });
});
