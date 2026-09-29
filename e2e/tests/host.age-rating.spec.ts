import { expect, test } from "@playwright/test";

import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import { hostPath } from "../src/urls";

/**
 * Public site age rating confirmation.
 *
 * Rated series and episodes are protected by a client-side gate until the
 * browser confirms the age rating in localStorage. A first-time visitor never
 * sees the body of a rated series or episode in the initial render.
 * Confirming R15 opens R15 only; confirming R18 opens both R15 and R18.
 */
test.describe("web-host age rating confirmation", () => {
  test("a first-time visitor sees the R15 confirmation gate and not the series body", async ({
    page,
  }) => {
    await page.goto(hostPath(`/series/${SEED_TENANT.r15Series.publicId}`));

    await expect(
      page.getByText(`“${SEED_TENANT.r15Series.title}” is rated R15`)
    ).toBeVisible();
    await expect(
      page.getByText("Confirm that you are 15 or older to open this series.")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "I am 15 or older" })
    ).toBeVisible();

    // Series body is hidden behind the gate.
    await expect(
      page.getByRole("heading", { level: 2, name: "Episodes" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Follow series" })
    ).toHaveCount(0);

    // Confirming R15 opens the series body.
    await page.getByRole("button", { name: "I am 15 or older" }).click();

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: SEED_TENANT.r15Series.title,
      })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Episodes" })
    ).toBeVisible();
  });

  test("a first-time visitor sees the R15 confirmation gate on an episode and confirming opens it", async ({
    page,
  }) => {
    const episodePath = `/series/${SEED_TENANT.r15Series.publicId}/episodes/${SEED_TENANT.r15Series.freeEpisodeId}`;
    await page.goto(hostPath(episodePath));

    await expect(
      page.getByText(`“${SEED_TENANT.r15Series.title}” is rated R15`)
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "I am 15 or older" })
    ).toBeVisible();

    // Episode body and title are hidden behind the gate.
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: new RegExp(SEED_TENANT.r15Series.freeEpisodeTitle, "u"),
      })
    ).toHaveCount(0);

    await page.getByRole("button", { name: "I am 15 or older" }).click();

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: new RegExp(SEED_TENANT.r15Series.freeEpisodeTitle, "u"),
      })
    ).toBeVisible();
  });

  test("confirming R15 opens R15 series but leaves R18 series behind the R18 gate", async ({
    page,
  }) => {
    // Confirm R15 first.
    await page.goto(hostPath(`/series/${SEED_TENANT.r15Series.publicId}`));
    await page.getByRole("button", { name: "I am 15 or older" }).click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: SEED_TENANT.r15Series.title,
      })
    ).toBeVisible();

    // R15 episode is accessible without another prompt.
    await page.goto(
      hostPath(
        `/series/${SEED_TENANT.r15Series.publicId}/episodes/${SEED_TENANT.r15Series.freeEpisodeId}`
      )
    );
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: new RegExp(SEED_TENANT.r15Series.freeEpisodeTitle, "u"),
      })
    ).toBeVisible();

    // R18 series still shows the R18 confirmation gate.
    await page.goto(hostPath(`/series/${SEED_TENANT.r18Series.publicId}`));
    await expect(
      page.getByText(`“${SEED_TENANT.r18Series.title}” is rated R18`)
    ).toBeVisible();
    await expect(
      page.getByText("Confirm that you are 18 or older to open this series.")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "I am 18 or older" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Episodes" })
    ).toHaveCount(0);
  });

  test("confirming R18 opens both R18 and R15 series", async ({ page }) => {
    await page.goto(hostPath(`/series/${SEED_TENANT.r18Series.publicId}`));

    await expect(
      page.getByText(`“${SEED_TENANT.r18Series.title}” is rated R18`)
    ).toBeVisible();
    await page.getByRole("button", { name: "I am 18 or older" }).click();

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: SEED_TENANT.r18Series.title,
      })
    ).toBeVisible();

    // R18 episode is open.
    await page.goto(
      hostPath(
        `/series/${SEED_TENANT.r18Series.publicId}/episodes/${SEED_TENANT.r18Series.freeEpisodeId}`
      )
    );
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: new RegExp(SEED_TENANT.r18Series.freeEpisodeTitle, "u"),
      })
    ).toBeVisible();

    // R15 series is also open because R18 confirmation satisfies R15.
    await page.goto(hostPath(`/series/${SEED_TENANT.r15Series.publicId}`));
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: SEED_TENANT.r15Series.title,
      })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Episodes" })
    ).toBeVisible();
  });
});
