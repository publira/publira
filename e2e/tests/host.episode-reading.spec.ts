import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { querySql, runSql } from "../src/db";
import { signInAsMember } from "../src/host";
import { SEED_MEMBER } from "../src/scenarios/member-announcements";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import {
  LAST_EPISODE_PATH,
  LAST_EPISODE_PRICE_LABEL,
  NEXT_EPISODE_PATH,
  NEXT_EPISODE_TITLE,
  PENULTIMATE_EPISODE_PATH,
  VIEWER_EPISODE_ID,
  VIEWER_EPISODE_PATH,
  VIEWER_EPISODE_TITLE,
  VIEWER_PAGE_COUNT,
  VIEWER_PROGRESS_LABEL,
  viewerPageImageId,
  viewerPageLabel,
} from "../src/scenarios/viewer-pages";
import { hostPath, WEB_HOST_EDGE_BASE_URL } from "../src/urls";

/**
 * A body image is `/images/episodes/{id}` on the reader's own origin, so the
 * Traefik edge is the only origin that serves a whole episode. The project
 * that already takes the edge as its `baseURL` is `viewer-performance`, and
 * this suite must not join it: that project runs alone so nothing competes
 * with what it times. It stays in the ordinary `web-host` project instead,
 * whose base is web-host on its own port, and names the edge in full here.
 */
const edgeUrl = (pathname: string): string =>
  `${WEB_HOST_EDGE_BASE_URL}${hostPath(pathname)}`;

const seriesPath = `/series/${SEED_TENANT.series.publicId}`;

/** The seed member's read of the seeded episode, if they have finished it. */
const READ_STATE_SCOPE = `
  FROM episode_reads r
      JOIN users u ON u.id = r.user_id
      JOIN episodes e ON e.id = r.episode_id
  WHERE u.email = '${SEED_MEMBER.email}'
      AND e.public_id = '${VIEWER_EPISODE_ID}'
`;

/** `read_at` of that read, or an empty string when there is none. */
const episodeReadAt = (): string =>
  querySql(`SELECT r.read_at ${READ_STATE_SCOPE};`);

/**
 * How many `episode_complete` events the read has been projected into.
 *
 * The projection is filed under `(source_table, source_id)`, so counting the
 * events that name this read is what tells a repeated notification apart from
 * a second completion.
 */
const episodeCompleteEventCount = (): string =>
  querySql(`
    SELECT COUNT(*)
    FROM content_events ce
    WHERE ce.event_type = 'episode_complete'
        AND ce.source_table = 'episode_reads'
        AND ce.source_id IN (SELECT r.id ${READ_STATE_SCOPE});
  `);

/**
 * Put this member back where they had never finished the episode.
 *
 * The events go first, because they are found through the read they came from
 * and `content_events` keeps no foreign key to `episode_reads` that would take
 * them along.
 */
const clearEpisodeReadState = (): void => {
  runSql(`
    BEGIN;
    DELETE FROM content_events ce
    WHERE ce.source_table = 'episode_reads'
        AND ce.source_id IN (SELECT r.id ${READ_STATE_SCOPE});
    DELETE FROM episode_reads
    WHERE id IN (SELECT r.id ${READ_STATE_SCOPE});
    COMMIT;
  `);
};

/** The seed member's saved position in the seeded episode. */
const READING_POSITION_SCOPE = `
  FROM episode_reading_positions p
      JOIN users u ON u.id = p.user_id
      JOIN episodes e ON e.id = p.episode_id
  WHERE u.email = '${SEED_MEMBER.email}'
      AND e.public_id = '${VIEWER_EPISODE_ID}'
`;

/**
 * The zero-based page that position names, or an empty string when the member
 * has no position in the episode.
 */
const savedPageIndex = (): string =>
  querySql(`SELECT p.page_index ${READING_POSITION_SCOPE};`);

/** Put this member back where they had never opened the episode. */
const clearReadingPosition = (): void => {
  runSql(`
    DELETE FROM episode_reading_positions
    WHERE (tenant_id, user_id, episode_id) IN (
        SELECT p.tenant_id, p.user_id, p.episode_id ${READING_POSITION_SCOPE}
    );
  `);
};

const readingProgress = (page: Page) => page.getByLabel(VIEWER_PROGRESS_LABEL);

/**
 * The viewer's own chrome, which links to the episodes either side of this one
 * from over the top of the pages.
 *
 * Named as a landmark because the rows below the reader link to the same two
 * episodes and label themselves the same way, so "Next episode" alone matches
 * both.
 */
const viewerNavigation = (page: Page) =>
  page.getByRole("navigation", { name: "Episode navigation" });

/** The reading history section of `/my`, which names itself as a landmark. */
const readingHistory = (page: Page) =>
  page.getByRole("region", { name: "Reading history" });

/** The history's entry for the seeded episode, as the link that opens it. */
const historyEntry = (page: Page) =>
  readingHistory(page).getByRole("link", { name: VIEWER_EPISODE_TITLE });

/**
 * The viewer's report that the episode is finished, answered.
 *
 * `sendBeacon` hands the report to the browser, which delivers it on its own
 * schedule, so the next screen this reader opens could otherwise be rendered
 * from a history the read had not reached yet. The Route Handler answers only
 * after the API has stored the read, so its response is the moment the history
 * behind every screen contains it. Start waiting before the last page turn:
 * the viewer sends the beacon the moment that page appears.
 */
const episodeReadReported = (page: Page): Promise<unknown> =>
  page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/episodes/${VIEWER_EPISODE_ID}/read`)
  );

const pageCanvas = (page: Page, pageNumber: number) =>
  page.locator(`canvas[aria-label="${viewerPageLabel(pageNumber)}"]`);

const expectFirstPageDrawn = (page: Page): Promise<void> =>
  expect(pageCanvas(page, 1)).toHaveAttribute("data-page-status", "loaded");

/**
 * Turn pages until the reader reports the last one, and hand back every
 * progress value it passed through.
 *
 * The reading direction is right to left, so ArrowLeft is the next page. The
 * `<progress>` reports the last page currently on screen, which is what makes
 * "the value went up" one statement whether the reader is showing a single
 * page or a spread.
 *
 * A turn shows at most two pages, so no episode needs more turns than it has
 * pages. That bound is what fails the test on a reader that has stopped
 * moving, rather than pressing the key until the suite times out.
 */
const turnToLastPage = async (
  page: Page,
  passed: readonly number[] = []
): Promise<number[]> => {
  const progress = readingProgress(page);
  const current = Number(await progress.getAttribute("value"));
  const visited = [...passed, current];

  if (current >= VIEWER_PAGE_COUNT || visited.length > VIEWER_PAGE_COUNT) {
    return visited;
  }

  await page.keyboard.press("ArrowLeft");
  await expect(progress).not.toHaveAttribute("value", String(current));

  return turnToLastPage(page, visited);
};

/**
 * Turn `count` pages forward, waiting for the reader to report each one.
 *
 * Recursive rather than a loop for the reason `turnToLastPage` is: each turn
 * has to be awaited before the next key press, and the reader's own report is
 * what says the turn happened.
 */
const turnPages = async (page: Page, count: number): Promise<void> => {
  if (count <= 0) {
    return;
  }

  const progress = readingProgress(page);
  const current = await progress.getAttribute("value");
  await page.keyboard.press("ArrowLeft");
  await expect(progress).not.toHaveAttribute("value", String(current));

  return turnPages(page, count - 1);
};

const isStrictlyAscending = (values: readonly number[]): boolean =>
  values.every(
    (value, index) => index === 0 || value > (values[index - 1] ?? value)
  );

/**
 * Reading one episode from its first page to its last, through the edge that
 * serves the reader and its body images under a single origin.
 *
 * What a finished read leaves behind is asserted through the reader's own
 * screens: `/my` lists it in the reading history, and the series page marks
 * the episode as finished. The reader's saved position is asserted the same
 * way — what they can see of it is the page the episode opens at, which is
 * what the resume test reads back.
 *
 * Two things are still read from the database, because they are not the
 * reader's to see: the stored `read_at` a repeated read must not move, and the
 * `episode_complete` events the engagement report counts. Those are storage and
 * analytics invariants of one reading, not state any screen reports.
 *
 * That read state and that position are the only things this suite writes, and
 * no other suite touches them, so the tests stay independent of one another
 * rather than running serially. Each test that writes one arranges it for
 * itself, which is also what makes a retry start from an unopened episode.
 */
test.describe("web-host episode reading", () => {
  test.afterAll(() => {
    clearEpisodeReadState();
    clearReadingPosition();
  });

  test("turning pages moves the reading progress to the last page of the episode", async ({
    page,
  }) => {
    await page.goto(edgeUrl(VIEWER_EPISODE_PATH));
    await expectFirstPageDrawn(page);

    await expect(readingProgress(page)).toHaveAttribute(
      "max",
      String(VIEWER_PAGE_COUNT)
    );

    const visited = await turnToLastPage(page);

    expect(visited.at(0), "the reader opens on the first page").toBe(1);
    expect(visited.at(-1), "the last turn reaches the last page").toBe(
      VIEWER_PAGE_COUNT
    );
    expect(
      isStrictlyAscending(visited),
      `every turn moved the reader forward: ${visited.join(", ")}`
    ).toBe(true);
    await expect(pageCanvas(page, VIEWER_PAGE_COUNT)).toHaveAttribute(
      "data-page-status",
      "loaded"
    );
  });

  test("finishing the episode puts it in the reader's history and marks it on the series page", async ({
    page,
  }) => {
    clearEpisodeReadState();
    clearReadingPosition();
    await signInAsMember(page, SEED_MEMBER, "/my", WEB_HOST_EDGE_BASE_URL);
    await expect(
      readingHistory(page).getByText("No reading history yet"),
      "the reader has finished nothing yet"
    ).toBeVisible();

    await page.goto(edgeUrl(VIEWER_EPISODE_PATH));
    await expectFirstPageDrawn(page);
    const readReported = episodeReadReported(page);
    await turnToLastPage(page);
    await readReported;

    await page.goto(edgeUrl("/my"));
    await expect(historyEntry(page)).toHaveAttribute(
      "href",
      hostPath(VIEWER_EPISODE_PATH)
    );

    await page.goto(edgeUrl(seriesPath));
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: VIEWER_EPISODE_TITLE })
        .getByText("Finished"),
      "the series page marks the episode the reader finished"
    ).toBeVisible();

    const firstReadAt = episodeReadAt();
    await expect
      .poll(episodeCompleteEventCount, {
        message: "the read reached the engagement projection",
      })
      .toBe("1");

    // The reader stopped on the last page, so that is where the episode opens
    // again. Waiting for the position to be written is what makes the return
    // land somewhere this test can name, and it puts the reader back on the
    // last page without a single turn — which is the re-read this asserts is
    // not a second completion.
    await expect
      .poll(savedPageIndex, { message: "the last page was saved" })
      .toBe(String(VIEWER_PAGE_COUNT - 1));

    await page.goto(edgeUrl(VIEWER_EPISODE_PATH));
    await expect(readingProgress(page)).toHaveAttribute(
      "value",
      String(VIEWER_PAGE_COUNT)
    );
    await expect(pageCanvas(page, VIEWER_PAGE_COUNT)).toHaveAttribute(
      "data-page-status",
      "loaded"
    );

    expect(episodeReadAt(), "the first read keeps its timestamp").toBe(
      firstReadAt
    );
    expect(
      episodeCompleteEventCount(),
      "a re-read is not a second completion"
    ).toBe("1");

    // A later session renders the history from the stored read rather than
    // from anything this browser was still holding.
    await page.context().clearCookies();
    await signInAsMember(page, SEED_MEMBER, "/my", WEB_HOST_EDGE_BASE_URL);
    await expect(
      historyEntry(page),
      "the history is still there in a new session"
    ).toBeVisible();
  });

  test("reopening the episode puts the member back on the page they stopped on", async ({
    page,
  }) => {
    clearReadingPosition();
    expect(savedPageIndex(), "the member has never opened the episode").toBe(
      ""
    );
    await signInAsMember(
      page,
      SEED_MEMBER,
      VIEWER_EPISODE_PATH,
      WEB_HOST_EDGE_BASE_URL
    );
    await expect(page).toHaveURL(new RegExp(`${VIEWER_EPISODE_PATH}$`, "u"));
    await expectFirstPageDrawn(page);

    await turnPages(page, 3);
    const stoppedOn = Number(await readingProgress(page).getAttribute("value"));
    expect(stoppedOn, "the reader moved off the first page").toBeGreaterThan(1);

    // `sendBeacon` hands the position to the browser, which delivers it on its
    // own schedule, and the viewer waits for the reader to settle before
    // handing over anything at all. Opening the episode saves the first page
    // on its own, so what this waits for is a page past it: `-1` stands for a
    // member who still has no position at all.
    await expect
      .poll(() => Number(savedPageIndex() || "-1"), {
        message: "the page the reader stopped on reached the database",
      })
      .toBeGreaterThan(0);

    await page.reload();

    await expect(readingProgress(page)).toHaveAttribute(
      "value",
      String(stoppedOn)
    );
  });

  test("the series page and the home page offer the episode the member stopped in", async ({
    page,
  }) => {
    clearEpisodeReadState();
    clearReadingPosition();
    await signInAsMember(
      page,
      SEED_MEMBER,
      VIEWER_EPISODE_PATH,
      WEB_HOST_EDGE_BASE_URL
    );
    await expect(page).toHaveURL(new RegExp(`${VIEWER_EPISODE_PATH}$`, "u"));
    await expectFirstPageDrawn(page);

    await turnPages(page, 2);
    await expect
      .poll(() => Number(savedPageIndex() || "-1"), {
        message: "the page the reader stopped on reached the database",
      })
      .toBeGreaterThan(0);

    await page.goto(edgeUrl(seriesPath));
    await expect(
      page.getByRole("link", { name: "Continue reading" })
    ).toHaveAttribute("href", hostPath(VIEWER_EPISODE_PATH));
    // The dot at the head of a row says what the button above the list says,
    // so it has to land on the same episode. It is a mark rather than words,
    // and this is the name it carries for a reader who cannot see it.
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: VIEWER_EPISODE_TITLE })
        .getByText("Next to read")
    ).toBeAttached();

    await page.goto(edgeUrl("/"));
    await expect(
      page
        .getByRole("region", { name: "Continue reading" })
        .getByRole("link", { name: SEED_TENANT.series.title })
    ).toHaveAttribute("href", hostPath(VIEWER_EPISODE_PATH));
  });

  test("a page that fails to load is retried on its own", async ({ page }) => {
    // The first attempt at the first page only. The retry the reader asks for
    // reaches the network, which is what makes this the failure of one page
    // rather than of the episode.
    await page.route(
      (url) => url.pathname === `/images/episodes/${viewerPageImageId(1)}`,
      (route) => route.abort("failed"),
      { times: 1 }
    );

    await page.goto(edgeUrl(VIEWER_EPISODE_PATH));

    const firstPage = pageCanvas(page, 1);
    await expect(firstPage).toHaveAttribute("data-page-status", "error");
    await expect(
      page.getByText("This page could not be loaded. Try again.")
    ).toBeVisible();

    await page.getByRole("button", { name: "Reload" }).click();

    await expect(firstPage).toHaveAttribute("data-page-status", "loaded");
    await expect(
      page.getByText("This page could not be loaded. Try again.")
    ).toHaveCount(0);
    // The control is drawn over the page, where a click near the edge of the
    // viewport would otherwise turn it: asking for the page again must not
    // carry the reader past it.
    await expect(readingProgress(page)).toHaveAttribute("value", "1");
    const visited = await turnToLastPage(page);
    expect(visited.at(-1), "the rest of the episode is still readable").toBe(
      VIEWER_PAGE_COUNT
    );
  });

  test("the end of an episode opens the next one in a single click", async ({
    page,
  }) => {
    await page.goto(edgeUrl(VIEWER_EPISODE_PATH));
    await expectFirstPageDrawn(page);

    await expect(
      viewerNavigation(page).getByRole("link", { name: "Next episode" }),
      "the viewer's own chrome links to the episode that follows"
    ).toHaveAttribute("href", hostPath(NEXT_EPISODE_PATH));
    await expect(
      viewerNavigation(page).getByRole("link", { name: "Previous episode" }),
      "and to the one before it"
    ).toBeVisible();

    await turnToLastPage(page);
    await page.getByRole("link", { name: NEXT_EPISODE_TITLE }).click();

    await expect(page).toHaveURL(new RegExp(`${NEXT_EPISODE_PATH}$`, "u"));
    await expect(
      page.getByRole("heading", { level: 1, name: NEXT_EPISODE_TITLE })
    ).toBeVisible();
  });

  test("a paid next episode says what it costs before the reader opens it", async ({
    page,
  }) => {
    await page.goto(edgeUrl(PENULTIMATE_EPISODE_PATH));

    await expect(
      page.getByRole("heading", { name: "More episodes" })
    ).toBeVisible();
    // The episode being read is free, so the only price on the page is the one
    // the row puts on the episode it offers.
    await expect(page.getByText(LAST_EPISODE_PRICE_LABEL)).toBeVisible();

    await page
      .getByRole("link", { name: SEED_TENANT.series.paidEpisodeTitle })
      .click();

    await expect(page).toHaveURL(new RegExp(`${LAST_EPISODE_PATH}$`, "u"));
    await expect(
      page.getByText("This episode is paid"),
      "the gate still decides who reads a paid body"
    ).toBeVisible();
  });

  test("the last episode of a series says so and offers to follow it", async ({
    page,
  }) => {
    await page.goto(edgeUrl(LAST_EPISODE_PATH));

    await expect(
      page.getByRole("heading", { name: "You are up to date" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: `Sign in to follow ${SEED_TENANT.series.title}`,
      })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Next episode" }),
      "there is no episode after the last one to offer, in the rows or over the pages"
    ).toHaveCount(0);
  });

  test("only the end of a series suggests other works to read", async ({
    page,
  }) => {
    await page.goto(edgeUrl(LAST_EPISODE_PATH));

    await expect(
      page.getByRole("heading", { name: "You may also like" })
    ).toBeVisible();

    await page.goto(edgeUrl(VIEWER_EPISODE_PATH));

    await expect(
      page.getByRole("heading", { name: "You may also like" }),
      "the next episode is the one offer a panel in the middle of a series makes"
    ).toHaveCount(0);
  });

  test("the running head below the viewer names its series and links back to it", async ({
    page,
  }) => {
    await page.goto(edgeUrl(VIEWER_EPISODE_PATH));

    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toContainText(VIEWER_EPISODE_TITLE);
    await expect(heading, "the episode carries its number").toContainText(
      "Episode 2"
    );
    await expect(
      page.getByRole("link", { exact: true, name: SEED_TENANT.series.title }),
      "the work the episode belongs to is the line above its title"
    ).toHaveAttribute("href", hostPath(seriesPath));
    await expect(
      page.getByRole("link", { name: "Back to the series" })
    ).toHaveAttribute("href", hostPath(seriesPath));
    await expect(page.getByText(`${VIEWER_PAGE_COUNT} pages`)).toBeVisible();
  });
});
