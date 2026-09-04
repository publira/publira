import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { querySql, runSql } from "../src/db";
import { signInAsMember } from "../src/host";
import { SEED_MEMBER } from "../src/scenarios/member-announcements";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import {
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

const readingProgress = (page: Page) => page.getByLabel(VIEWER_PROGRESS_LABEL);

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

const isStrictlyAscending = (values: readonly number[]): boolean =>
  values.every(
    (value, index) => index === 0 || value > (values[index - 1] ?? value)
  );

/**
 * Reading one episode from its first page to its last, through the edge that
 * serves the reader and its body images under a single origin.
 *
 * The read state a finished episode leaves behind is asserted in the database,
 * because no screen a reader can reach reports it: `/my`'s reading history is a
 * fixed empty state, `/my/library` lists purchases and this episode is free,
 * and the public API has no RPC that reads `episode_reads` back — see
 * https://github.com/publira/publira/issues/1503. What the reader does produce
 * is the beacon the viewer sends on the last page, so the record is still
 * reached the way a reader reaches it rather than written by the fixture.
 *
 * That read state is the only thing this suite writes, and no other suite
 * touches it, so the tests stay independent of one another rather than running
 * serially. The one test that writes it arranges it for itself, which is also
 * what makes a retry start from an unread episode.
 */
test.describe("web-host episode reading", () => {
  test.afterAll(() => {
    clearEpisodeReadState();
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

  test("finishing the episode records the member's read and keeps it across a reload", async ({
    page,
  }) => {
    clearEpisodeReadState();
    await signInAsMember(
      page,
      SEED_MEMBER,
      VIEWER_EPISODE_PATH,
      WEB_HOST_EDGE_BASE_URL
    );
    await expect(page).toHaveURL(new RegExp(`${VIEWER_EPISODE_PATH}$`, "u"));
    expect(episodeReadAt(), "unread before the reader finishes it").toBe("");

    await expectFirstPageDrawn(page);
    await turnToLastPage(page);

    // `sendBeacon` hands the report to the browser, which delivers it on its
    // own schedule, so the record lands after the last page rather than with
    // it.
    await expect
      .poll(episodeReadAt, { message: "the finished read was recorded" })
      .not.toBe("");
    const firstReadAt = episodeReadAt();
    await expect
      .poll(episodeCompleteEventCount, {
        message: "the read reached the engagement projection",
      })
      .toBe("1");

    await page.reload();
    await expectFirstPageDrawn(page);
    await turnToLastPage(page);

    expect(episodeReadAt(), "the first read keeps its timestamp").toBe(
      firstReadAt
    );
    expect(
      episodeCompleteEventCount(),
      "a re-read is not a second completion"
    ).toBe("1");
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
      page.getByText("This page could not be loaded.")
    ).toBeVisible();

    await page.getByRole("button", { name: "Reload" }).click();

    await expect(firstPage).toHaveAttribute("data-page-status", "loaded");
    await expect(page.getByText("This page could not be loaded.")).toHaveCount(
      0
    );
    // The control is drawn over the page, where a click near the edge of the
    // viewport would otherwise turn it: asking for the page again must not
    // carry the reader past it.
    await expect(readingProgress(page)).toHaveAttribute("value", "1");
    const visited = await turnToLastPage(page);
    expect(visited.at(-1), "the rest of the episode is still readable").toBe(
      VIEWER_PAGE_COUNT
    );
  });

  test("the episode information below the viewer names its series and links back to it", async ({
    page,
  }) => {
    await page.goto(edgeUrl(VIEWER_EPISODE_PATH));

    await expect(
      page.getByRole("heading", { level: 1, name: VIEWER_EPISODE_TITLE })
    ).toBeVisible();
    await expect(
      page.getByText(`An episode of “${SEED_TENANT.series.title}”.`)
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Go to the series" })
    ).toHaveAttribute("href", hostPath(seriesPath));
    await expect(
      page.getByRole("link", { exact: true, name: "Series detail" })
    ).toHaveAttribute("href", hostPath(seriesPath));
    await expect(page.getByText(`${VIEWER_PAGE_COUNT} pages`)).toBeVisible();
  });
});
