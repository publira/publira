import { randomUUID } from "node:crypto";

import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { turnToEndPage } from "./viewer";

/**
 * A comment body no other attempt has posted.
 *
 * The API refuses the same body from the same reader on the same episode for a
 * window, which is what stops a comment box from being a flood channel. The
 * counters behind that refusal live in Redis rather than in the database, so
 * resetting the scenario rows does not reset them: a retry, or a second run of
 * the suite inside the window, would re-send text its earlier attempt already
 * posted and be answered by the guard instead of by the behaviour under test.
 *
 * Call it inside the test rather than once per module, so a retry gets its own
 * body whether or not it runs in a fresh worker.
 */
export const uniqueCommentBody = (text: string): string =>
  `${text} [${randomUUID().slice(0, 8)}]`;

/**
 * The control that opens the comments, which the page after the last page of
 * the episode carries and no other page does.
 *
 * `exact`: the viewport around the pages is a `role="button"` of its own, and
 * its accessible name is everything the page on screen holds.
 */
export const commentsTrigger = (page: Page) =>
  page.getByRole("button", { exact: true, name: "Comments" });

/** The comments themselves, which only the open dialog holds. */
export const commentsDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Comments" });

/**
 * The box a reader writes in.
 *
 * By role rather than by label, so it is the box the reader can actually reach:
 * the dialog is the only place that has one, and a closed dialog renders
 * nothing at all.
 *
 * `exact`: Playwright matches an accessible name as a case-insensitive
 * substring, and the delete control on a comment is labelled "Delete your
 * comment posted on …".
 */
export const commentBox = (page: Page) =>
  page.getByRole("textbox", { exact: true, name: "Your comment" });

/**
 * Turn forward until the comments are offered, and answer whether they ever
 * were.
 *
 * A press with nothing left to turn to is harmless on the episodes the
 * commenting scenarios seed, because each is the last of its series: the arrow
 * key has no next episode to arm, so it cannot carry the reader out of the
 * episode.
 *
 * It answers `false` rather than failing, because an episode whose series takes
 * no comments ends on a page that carries only the reaction.
 */
export const turnTowardComments = (page: Page): Promise<boolean> =>
  turnToEndPage(page, commentsTrigger(page));

/**
 * Read to the end, then open the comments — the order the reader is offered.
 *
 * Fails the test where the control never arrives, which is what makes the
 * absence of the comments a result rather than a timeout further down.
 */
export const openComments = async (page: Page): Promise<void> => {
  // An open dialog takes the rest of the page out of the accessibility tree,
  // so the control that opened it is no longer there to press again.
  if (await commentsDialog(page).isVisible()) {
    return;
  }

  if (!(await turnTowardComments(page))) {
    await expect(commentsTrigger(page)).toBeVisible();
  }

  await commentsTrigger(page).click();
  await expect(commentsDialog(page)).toBeVisible();
};

/**
 * Post one comment the way a reader does.
 *
 * `exact` on the submit control for the reason `commentsTrigger` needs it.
 */
export const postComment = async (page: Page, body: string): Promise<void> => {
  await openComments(page);
  await commentBox(page).fill(body);
  await page.getByRole("button", { exact: true, name: "Post comment" }).click();
};
