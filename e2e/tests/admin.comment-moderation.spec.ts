import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { signInAsAdmin } from "../src/admin";
import { applyScenarioSql } from "../src/db";
import { signInAsMember } from "../src/host";
import {
  episodeCommentsTag,
  revalidateHostTags,
  tenantSiteTag,
} from "../src/revalidate";
import {
  COMMENT_MODERATION_ADMIN,
  COMMENT_MODERATION_EPISODE,
  COMMENT_MODERATION_MEMBER,
  COMMENT_MODERATION_PATH,
  COMMENT_MODERATION_SCENARIO,
  COMMENT_MODERATION_TENANT,
} from "../src/scenarios/comment-moderation";
import {
  hostPath,
  WEB_ADMIN_COMMENT_MODERATION_BASE_URL,
  WEB_HOST_COMMENT_MODERATION_BASE_URL,
} from "../src/urls";

/**
 * Moderating comments from the console, on a tenant that holds every comment
 * for approval.
 *
 * The whole round trip goes through the product: a reader posts from the site,
 * an administrator acts from `/comments`, and the result is read back off the
 * public page. Nothing here writes to Postgres except the scenario seed that
 * empties the queue between runs.
 */

const episodeUrl = `${WEB_HOST_COMMENT_MODERATION_BASE_URL}${hostPath(COMMENT_MODERATION_PATH)}`;

const commentsSection = (page: Page) =>
  page.getByRole("heading", { level: 2, name: "Comments" });

/**
 * `exact`: Playwright matches an accessible name as a case-insensitive
 * substring, and the delete control on a comment is labelled "Delete your
 * comment posted on …".
 */
const commentBox = (page: Page) =>
  page.getByLabel("Your comment", { exact: true });

const postComment = async (page: Page, body: string): Promise<void> => {
  await commentBox(page).fill(body);
  await page.getByRole("button", { name: "Post comment" }).click();
};

/** Choose one mode on the settings card and submit it. */
const saveCommentMode = async (page: Page, option: string): Promise<void> => {
  await page.getByRole("radio", { exact: true, name: option }).click();
  await page
    .getByRole("button", { name: "Save how comments are published" })
    .click();
};

/** The console row for one comment, found by the text of the comment itself. */
const consoleRow = (page: Page, body: string) =>
  page.getByRole("row").filter({ hasText: body });

/**
 * One open confirmation dialog, named by its title.
 *
 * The name is not decoration: a toast is a `role="dialog"` too, so a bare
 * `getByRole("dialog")` matches the success toast of the previous action as
 * well as the popup this step opened.
 */
const openDialog = (page: Page, title: string) =>
  page.getByRole("dialog", { name: title });

/**
 * Read the episode page again and again until the comment list catches up.
 *
 * Revalidation marks a `"use cache"` entry stale rather than dropping it, so
 * the request right after it is still answered from the old copy. Waiting on a
 * single navigation would be waiting on a page that can never change.
 */
const pollEpisodePage = <T>(page: Page, read: () => Promise<T>) =>
  expect.poll(
    async () => {
      await page.goto(episodeUrl);
      await expect(commentsSection(page)).toBeVisible();
      return await read();
    },
    {
      message: "the public comment list never caught up with the console",
      timeout: 30_000,
    }
  );

/**
 * Read the episode page again and again until the comment section itself comes
 * or goes. Separate from {@link pollEpisodePage}, which waits for that section
 * before it reads: here the section's absence is the answer.
 */
const pollCommentsSection = (page: Page) =>
  expect.poll(
    async () => {
      // `goto` settles on the document's load event, and the section is
      // streamed into that same response, so what it holds by then is final.
      await page.goto(episodeUrl);
      return await commentsSection(page).count();
    },
    {
      message: "the episode page never caught up with the saved comment mode",
      timeout: 30_000,
    }
  );

/**
 * Put the tenant back the way the suite needs it and tell web-host about it.
 *
 * The scenario file deletes the comments a previous run wrote and writes the
 * tenant's comment mode back to `approval_required`, both of them writes no app
 * saw: without the tags the cached public list would still be serving that
 * run's approved comments, and the site chrome would still be carrying the mode
 * the last run left behind.
 */
const resetComments = async (): Promise<void> => {
  applyScenarioSql(COMMENT_MODERATION_SCENARIO);
  await revalidateHostTags([
    episodeCommentsTag(
      COMMENT_MODERATION_TENANT.id,
      COMMENT_MODERATION_EPISODE.publicId
    ),
    tenantSiteTag(COMMENT_MODERATION_TENANT.id),
  ]);
};

// The suite works one queue on one episode, so its tests run in order rather
// than beside each other.
test.describe.configure({ mode: "serial" });

test.describe("web-admin comment moderation", () => {
  test.beforeAll(async () => {
    await resetComments();
  });

  test.afterAll(async () => {
    await resetComments();
  });

  test("an approved comment reaches the public episode page", async ({
    browser,
    page,
  }) => {
    const body = "A comment the moderators will let through.";
    await signInAsMember(
      page,
      COMMENT_MODERATION_MEMBER,
      COMMENT_MODERATION_PATH,
      WEB_HOST_COMMENT_MODERATION_BASE_URL
    );
    await postComment(page, body);
    await expect(
      page.getByText(
        "Your comment has been sent for approval. It appears here once a moderator approves it."
      )
    ).toBeVisible();

    const consoleContext = await browser.newContext();
    const consolePage = await consoleContext.newPage();
    try {
      await signInAsAdmin(
        consolePage,
        COMMENT_MODERATION_ADMIN,
        "/comments",
        WEB_ADMIN_COMMENT_MODERATION_BASE_URL
      );

      const row = consoleRow(consolePage, body);
      await expect(row).toBeVisible();
      await expect(row.getByText("Awaiting approval")).toBeVisible();
      await expect(row.getByText(COMMENT_MODERATION_MEMBER.name)).toBeVisible();
      // The episode is a link into the console, so a moderator can read the
      // comment beside what it is about.
      await expect(
        row.getByRole("link", { name: COMMENT_MODERATION_EPISODE.title })
      ).toHaveAttribute(
        "href",
        `/series/${COMMENT_MODERATION_EPISODE.seriesPublicId}/episodes/${COMMENT_MODERATION_EPISODE.publicId}`
      );

      await row.getByRole("button", { exact: true, name: "Approve" }).click();
      await expect(
        consolePage.getByText("The comment was published.")
      ).toBeVisible();
      await expect(
        consoleRow(consolePage, body).getByText("Published")
      ).toBeVisible();
    } finally {
      await consoleContext.close();
    }

    // The approval is what makes the comment public, and the API drops the
    // storefront's cached list for the episode as it lands.
    const readerContext = await browser.newContext();
    const readerPage = await readerContext.newPage();
    try {
      await pollEpisodePage(readerPage, () =>
        readerPage.getByText(body).count()
      ).toBe(1);
    } finally {
      await readerContext.close();
    }
  });

  test("a removed comment leaves the public page and comes back on a restore", async ({
    browser,
    page,
  }) => {
    const body = "A comment the moderators will take down and put back.";
    await signInAsMember(
      page,
      COMMENT_MODERATION_MEMBER,
      COMMENT_MODERATION_PATH,
      WEB_HOST_COMMENT_MODERATION_BASE_URL
    );
    await postComment(page, body);

    const consoleContext = await browser.newContext();
    const consolePage = await consoleContext.newPage();
    const readerContext = await browser.newContext();
    const readerPage = await readerContext.newPage();
    try {
      await signInAsAdmin(
        consolePage,
        COMMENT_MODERATION_ADMIN,
        "/comments",
        WEB_ADMIN_COMMENT_MODERATION_BASE_URL
      );
      await consoleRow(consolePage, body)
        .getByRole("button", { exact: true, name: "Approve" })
        .click();
      await expect(
        consoleRow(consolePage, body).getByText("Published")
      ).toBeVisible();
      await pollEpisodePage(readerPage, () =>
        readerPage.getByText(body).count()
      ).toBe(1);

      await consoleRow(consolePage, body)
        .getByRole("button", { exact: true, name: "Remove" })
        .click();
      const removeDialog = openDialog(consolePage, "Remove this comment?");
      await expect(removeDialog).toBeVisible();
      await removeDialog
        .getByRole("button", { exact: true, name: "Remove" })
        .click();
      await expect(
        consolePage.getByText("The comment was removed.")
      ).toBeVisible();

      const removedRow = consoleRow(consolePage, body);
      await expect(
        removedRow.getByText("Removed by a moderator.")
      ).toBeVisible();
      // A removal is silent, and staff have to be told so they are not caught
      // out by the author quoting it back at them.
      await expect(
        removedRow.getByText(
          "The author still sees it exactly as they posted it — they are never told about a removal."
        )
      ).toBeVisible();
      await pollEpisodePage(readerPage, () =>
        readerPage.getByText(body).count()
      ).toBe(0);

      await consoleRow(consolePage, body)
        .getByRole("button", { exact: true, name: "Restore" })
        .click();
      await expect(
        consolePage.getByText("The comment was restored.")
      ).toBeVisible();
      await pollEpisodePage(readerPage, () =>
        readerPage.getByText(body).count()
      ).toBe(1);
    } finally {
      await consoleContext.close();
      await readerContext.close();
    }
  });

  test("purging asks for a reason, says it cannot be undone, and removes the row", async ({
    browser,
    page,
  }) => {
    const body = "A comment that has to be gone for good.";
    await signInAsMember(
      page,
      COMMENT_MODERATION_MEMBER,
      COMMENT_MODERATION_PATH,
      WEB_HOST_COMMENT_MODERATION_BASE_URL
    );
    await postComment(page, body);

    const consoleContext = await browser.newContext();
    const consolePage = await consoleContext.newPage();
    try {
      await signInAsAdmin(
        consolePage,
        COMMENT_MODERATION_ADMIN,
        "/comments",
        WEB_ADMIN_COMMENT_MODERATION_BASE_URL
      );
      await consoleRow(consolePage, body)
        .getByRole("button", { exact: true, name: "Purge" })
        .click();

      const purgeDialog = openDialog(
        consolePage,
        "Purge this comment for good?"
      );
      await expect(purgeDialog).toBeVisible();
      await expect(
        purgeDialog.getByText(/this cannot be undone/u)
      ).toBeVisible();

      await purgeDialog
        .getByRole("textbox", { name: "Reason" })
        .fill("Personal information in the text.");
      await purgeDialog
        .getByRole("button", { exact: true, name: "Purge" })
        .click();

      await expect(
        consolePage.getByText("The comment was purged.")
      ).toBeVisible();
      await expect(consoleRow(consolePage, body)).toHaveCount(0);
    } finally {
      await consoleContext.close();
    }
  });

  // The setting is the one thing that decides whether the storefront offers
  // commenting at all, so it is measured where a reader would see it rather
  // than by reading the console back.
  test("turning comments off in the settings takes the section off the public page", async ({
    browser,
    page,
  }) => {
    await signInAsAdmin(
      page,
      COMMENT_MODERATION_ADMIN,
      "/settings",
      WEB_ADMIN_COMMENT_MODERATION_BASE_URL
    );

    const readerContext = await browser.newContext();
    const readerPage = await readerContext.newPage();
    try {
      await readerPage.goto(episodeUrl);
      await expect(commentsSection(readerPage)).toBeVisible();

      await saveCommentMode(page, "Do not accept comments");
      await expect(
        page.getByText("How comments are published was saved.")
      ).toBeVisible();
      await pollCommentsSection(readerPage).toBe(0);

      // Back to what the rest of the suite runs on. The poll is what says this
      // save landed: both saves report the same sentence, so the message left
      // over from the first one would satisfy an assertion about this one.
      await saveCommentMode(page, "Publish after approval");
      await pollCommentsSection(readerPage).toBe(1);
      await expect(
        readerPage.getByText(
          "A comment appears here once a moderator approves it."
        )
      ).toBeVisible();
    } finally {
      await readerContext.close();
    }
  });
});
