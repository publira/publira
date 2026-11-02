import type { Browser, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { episodeFormFields, signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import { toSeedTenantDateTimeLocal } from "../src/scenarios/admin-publish";
import {
  EPISODE_REVIEW_ADMIN,
  EPISODE_REVIEW_AUDITOR,
  EPISODE_REVIEW_CATALOG,
  EPISODE_REVIEW_EDITOR,
  EPISODE_REVIEW_SCENARIO,
} from "../src/scenarios/episode-review";
import { WEB_ADMIN_EPISODE_REVIEW_BASE_URL } from "../src/urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_EPISODE_REVIEW_BASE_URL}${pathname}`;

const episodePath = `/series/${EPISODE_REVIEW_CATALOG.seriesPublicId}/episodes/${EPISODE_REVIEW_CATALOG.episodePublicId}`;

const RETURN_COMMENT =
  "Page 3 is upside down. Turn it before submitting again.";

/** A browser of its own for one member of staff, signed in on the episode. */
const signedInPage = async (
  browser: Browser,
  credentials: { email: string; password: string }
): Promise<Page> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAsAdmin(
    page,
    credentials,
    episodePath,
    WEB_ADMIN_EPISODE_REVIEW_BASE_URL
  );

  return page;
};

/** The episode's Review section, once it has streamed in. */
const reviewSection = (page: Page) =>
  page.locator("section", {
    has: page.getByRole("heading", { exact: true, name: "Review" }),
  });

/** Opens the episode and waits for its Publishing settings to arrive. */
const openEpisode = async (page: Page): Promise<void> => {
  await page.goto(adminUrl(episodePath));
  await expect(
    page.getByRole("button", { name: "Update publication date and time" })
  ).toBeVisible();
};

/**
 * A tenant that requires review, from the setting to an approval: the editor
 * schedules a draft, which submits it, the tenant admin returns it with a
 * comment, the editor reads the comment and submits it again, and the tenant
 * admin approves it. The auditor reads every round and is offered no control.
 */
test.describe("episode review in the console", () => {
  test.beforeAll(() => {
    applyScenarioSql(EPISODE_REVIEW_SCENARIO);
  });

  test("takes an episode through a return and an approval", async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const admin = await signedInPage(browser, EPISODE_REVIEW_ADMIN);
    const editor = await signedInPage(browser, EPISODE_REVIEW_EDITOR);

    // Review off: the episode screen is what it has always been. The note
    // sits in the same section as the button, so it has had its answer.
    await openEpisode(admin);
    await expect(admin.getByText(/This tenant requires review/u)).toHaveCount(
      0
    );
    await expect(
      admin.getByRole("button", { name: "Submit for review" })
    ).toHaveCount(0);

    // The tenant admin turns review on.
    await admin.goto(adminUrl("/settings"));

    const required = admin.getByRole("checkbox", {
      name: "Require review before publishing",
    });

    await expect(required).toHaveAttribute("aria-checked", "false");
    await required.click();
    await admin
      .getByRole("button", { name: "Save the review setting" })
      .click();
    await expect(
      admin.getByText("The review setting was saved.")
    ).toBeVisible();

    // The editor saves a time, which submits the draft rather than
    // scheduling it on its own.
    await openEpisode(editor);
    await expect(
      editor.getByText(/This tenant requires review/u)
    ).toBeVisible();
    await episodeFormFields(editor).publishAt.fill(
      toSeedTenantDateTimeLocal(Temporal.Now.instant().add({ hours: 24 * 30 }))
    );
    await editor
      .getByRole("button", { name: "Update publication date and time" })
      .click();
    await expect(
      editor.getByText("Publication date and time updated.")
    ).toBeVisible();
    await expect(
      reviewSection(editor).getByText(/^Submitted by Review Editor on /u)
    ).toBeVisible();
    await expect(
      reviewSection(editor).getByText("Waiting for a Tenant admin's decision.")
    ).toBeVisible();
    // Deciding is a Tenant admin's alone.
    await expect(
      editor.getByRole("button", { exact: true, name: "Approve" })
    ).toHaveCount(0);

    // The list and the Dashboard mark the episode as waiting.
    await editor.goto(
      adminUrl(`/series/${EPISODE_REVIEW_CATALOG.seriesPublicId}/episodes`)
    );

    const row = editor
      .getByRole("listitem")
      .filter({ hasText: EPISODE_REVIEW_CATALOG.episodeTitle });

    await expect(row.getByText("In review", { exact: true })).toBeVisible();

    await admin.goto(adminUrl("/"));
    await expect(admin.getByText("Waiting for review")).toBeVisible();
    await expect(
      admin
        .getByRole("row")
        .filter({ hasText: EPISODE_REVIEW_CATALOG.episodeTitle })
        .getByText("In review", { exact: true })
    ).toBeVisible();

    // A return has to say what to fix.
    await openEpisode(admin);
    await admin.getByRole("button", { exact: true, name: "Return" }).click();
    await expect(
      admin.getByText("Write what to fix before returning the episode.").first()
    ).toBeVisible();

    await admin.getByRole("textbox", { name: "Comment" }).fill(RETURN_COMMENT);
    await admin.getByRole("button", { exact: true, name: "Return" }).click();
    await expect(admin.getByText("Episode returned.")).toBeVisible();
    await expect(
      reviewSection(admin).getByText(/^Returned by Review Admin on /u)
    ).toBeVisible();

    // The editor reads the comment and submits the episode again, without
    // moving its time.
    await openEpisode(editor);
    await expect(reviewSection(editor).getByText(RETURN_COMMENT)).toBeVisible();
    await editor.getByRole("button", { name: "Submit for review" }).click();
    await expect(editor.getByText("Submitted for review.")).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "Submit for review" })
    ).toHaveCount(0);
    await expect(
      reviewSection(editor).getByText("Waiting for a Tenant admin's decision.")
    ).toBeVisible();

    // The tenant admin approves it, with no comment.
    await openEpisode(admin);
    await admin.getByRole("button", { exact: true, name: "Approve" }).click();
    await expect(admin.getByText("Episode approved.")).toBeVisible();
    await expect(
      reviewSection(admin).getByText(/^Approved by Review Admin on /u)
    ).toBeVisible();
    await expect(
      admin.getByRole("button", { exact: true, name: "Approve" })
    ).toHaveCount(0);

    // The auditor reads both rounds and the comment, and decides nothing.
    const auditor = await signedInPage(browser, EPISODE_REVIEW_AUDITOR);
    await openEpisode(auditor);
    const auditorReview = reviewSection(auditor);
    await expect(auditorReview.getByRole("listitem")).toHaveCount(2);
    await expect(auditorReview.getByText(RETURN_COMMENT)).toBeVisible();

    await Promise.all(
      ["Approve", "Return", "Submit for review"].map((name) =>
        expect(auditor.getByRole("button", { exact: true, name })).toHaveCount(
          0
        )
      )
    );

    await Promise.all(
      [admin, editor, auditor].map((page) => page.context().close())
    );
  });
});
