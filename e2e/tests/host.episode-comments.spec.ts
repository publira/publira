import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { applyScenarioSql, quoteSqlLiteral, runSql } from "../src/db";
import { signInAsMember } from "../src/host";
import { episodeCommentsTag, revalidateHostTags } from "../src/revalidate";
import {
  EPISODE_COMMENTS_AUTHOR,
  EPISODE_COMMENTS_EPISODE,
  EPISODE_COMMENTS_PATH,
  EPISODE_COMMENTS_READER,
  EPISODE_COMMENTS_SCENARIO,
  EPISODE_COMMENTS_TENANT,
} from "../src/scenarios/episode-comments";
import { hostPath, WEB_HOST_EPISODE_COMMENTS_BASE_URL } from "../src/urls";

/**
 * Commenting on a published episode, from both sides of the one rule that
 * cannot be read off the screen: a comment staff removed keeps rendering to its
 * author, unchanged, and is gone for everyone else.
 *
 * The removal is written straight to Postgres. What staff do is asserted from
 * the console by `admin.comment-moderation.spec.ts`; here the removal is only
 * the precondition, and this tenant publishes comments immediately, so the
 * database is the shortest way to reach the state the reader-side rules are
 * about.
 */

const episodeUrl = `${WEB_HOST_EPISODE_COMMENTS_BASE_URL}${hostPath(EPISODE_COMMENTS_PATH)}`;

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

/** Remove one comment the way staff moderation will. */
const hideComment = (body: string): void => {
  runSql(`
    UPDATE episode_comments
    SET status = 'hidden',
        hidden_at = NOW(),
        hidden_reason = 'staff',
        updated_at = NOW()
    WHERE episode_id = '${EPISODE_COMMENTS_EPISODE.id}'::uuid
      AND body = ${quoteSqlLiteral(body)};
  `);
};

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
      message: "the comment list never caught up with the database",
      timeout: 30_000,
    }
  );

/**
 * Empty the list and tell web-host about it.
 *
 * The scenario file deletes the comments a previous run wrote, which is a
 * write the app never saw: without the tag the cached public list would still
 * be serving that run's comments to this one.
 */
const resetComments = async (): Promise<void> => {
  applyScenarioSql(EPISODE_COMMENTS_SCENARIO);
  await revalidateHostTags([
    episodeCommentsTag(
      EPISODE_COMMENTS_TENANT.id,
      EPISODE_COMMENTS_EPISODE.publicId
    ),
  ]);
};

// The suite posts, removes, and deletes comments on one episode, so its tests
// have to run in order rather than beside each other.
test.describe.configure({ mode: "serial" });

test.describe("web-host episode comments", () => {
  test.beforeAll(async () => {
    await resetComments();
  });

  test.afterAll(async () => {
    await resetComments();
  });

  test("a signed-out reader is invited to sign in instead of being shown a form", async ({
    page,
  }) => {
    await page.goto(episodeUrl);

    await expect(commentsSection(page)).toBeVisible();
    await expect(page.getByText("Sign in to leave a comment.")).toBeVisible();
    await expect(commentBox(page)).toHaveCount(0);
  });

  test("a signed-in reader posts a comment and finds it in the list", async ({
    page,
  }) => {
    const body = "This episode landed the ending perfectly.";
    await signInAsMember(
      page,
      EPISODE_COMMENTS_AUTHOR,
      EPISODE_COMMENTS_PATH,
      WEB_HOST_EPISODE_COMMENTS_BASE_URL
    );
    await pollEpisodePage(page, () =>
      page.getByText("No comments yet.").count()
    ).toBe(1);

    await postComment(page, body);

    await expect(page.getByText("Your comment has been posted.")).toBeVisible();
    const comment = page.getByRole("listitem").filter({ hasText: body });
    await expect(comment).toBeVisible();
    await expect(comment.getByText(EPISODE_COMMENTS_AUTHOR.name)).toBeVisible();
    // The tenant publishes immediately, so nothing may say the comment is
    // waiting for anyone.
    await expect(page.getByText("Awaiting approval")).toHaveCount(0);
  });

  test("a comment removed by staff stays with its author and leaves every other reader's page", async ({
    browser,
    page,
  }) => {
    const body = "A comment the moderators will take down.";
    await signInAsMember(
      page,
      EPISODE_COMMENTS_AUTHOR,
      EPISODE_COMMENTS_PATH,
      WEB_HOST_EPISODE_COMMENTS_BASE_URL
    );
    await page.goto(episodeUrl);
    await postComment(page, body);
    await expect(page.getByText("Your comment has been posted.")).toBeVisible();

    hideComment(body);
    await revalidateHostTags([
      episodeCommentsTag(
        EPISODE_COMMENTS_TENANT.id,
        EPISODE_COMMENTS_EPISODE.publicId
      ),
    ]);

    const readerContext = await browser.newContext();
    const readerPage = await readerContext.newPage();
    try {
      await signInAsMember(
        readerPage,
        EPISODE_COMMENTS_READER,
        EPISODE_COMMENTS_PATH,
        WEB_HOST_EPISODE_COMMENTS_BASE_URL
      );
      await pollEpisodePage(readerPage, () =>
        readerPage.getByText(body).count()
      ).toBe(0);
    } finally {
      await readerContext.close();
    }

    // The author's own read is uncached, so the comment is back on their page
    // the moment they reload — with nothing on it saying it was removed.
    await page.goto(episodeUrl);
    const comment = page.getByRole("listitem").filter({ hasText: body });
    await expect(comment).toBeVisible();
    await expect(comment.getByText("Awaiting approval")).toHaveCount(0);
  });

  test("the author deletes a comment and it leaves their own page too", async ({
    page,
  }) => {
    const body = "A comment its author will think better of.";
    await signInAsMember(
      page,
      EPISODE_COMMENTS_AUTHOR,
      EPISODE_COMMENTS_PATH,
      WEB_HOST_EPISODE_COMMENTS_BASE_URL
    );
    await page.goto(episodeUrl);
    await postComment(page, body);
    await expect(page.getByText("Your comment has been posted.")).toBeVisible();

    const comment = page.getByRole("listitem").filter({ hasText: body });
    await comment
      .getByRole("button", { name: /^Delete your comment/u })
      .click();

    // The row goes rather than the button: the Action re-renders the section
    // without the comment, so the control and the message beside it leave with
    // it.
    await expect(comment).toHaveCount(0);
    // The comment was published the moment it was posted, so the cached public
    // list holds it too. Poll for the reload, the way the reader-side
    // assertion above does.
    await pollEpisodePage(page, () => page.getByText(body).count()).toBe(0);
  });
});
