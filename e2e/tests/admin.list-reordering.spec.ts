import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  createEpisodeViaUi,
  createSeriesViaUi,
  fillField,
  reorderWithKeyboard,
  signInAsSeedAdmin,
} from "../src/admin";
import { deleteCreatorRolesByNames, deleteSeriesByPublicIds } from "../src/db";
import { switchConsoleLocale } from "../src/locale";
import { uniqueSuffix } from "../src/scenarios/admin-publish";
import { EYE_CATCH_ASPECT_FIXTURES } from "../src/scenarios/eye-catch";
import { serverActionAnswered } from "../src/server-action";
import { WEB_ADMIN_BASE_URL } from "../src/urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

/** What each row of a named list shows, in the order the console lists them. */
const rowTexts = async (page: Page, listName: string): Promise<string[]> => {
  const rows = await page
    .getByRole("list", { exact: true, name: listName })
    .getByRole("listitem")
    .all();
  return await Promise.all(
    rows.map(async (row) => (await row.textContent()) ?? "")
  );
};

/**
 * The titles this test made, in the order the episode list shows them. Other
 * titles are dropped, so the assertion is about the rows the test owns.
 */
const episodeTitlesInOrder = async (
  page: Page,
  titles: readonly string[]
): Promise<string[]> => {
  const rows = await rowTexts(page, "Episodes");
  return rows.flatMap((text) => titles.filter((title) => text.includes(title)));
};

/** The grip one episode row is dragged by, which names the episode it moves. */
const episodeHandle = (page: Page, title: string): Locator =>
  page.getByRole("button", { exact: true, name: `Reorder ${title}` });

/**
 * The size each page image reports, in the order the grid shows them. The
 * caption also carries the position, which is what a reorder changes, so the
 * size is what identifies one image across a move.
 */
const imageSizesInOrder = async (page: Page): Promise<string[]> => {
  const rows = await rowTexts(page, "Registered page images");
  return rows.flatMap((text) => {
    const match = text.match(/(?<size>\d+x\d+)/u);
    return match?.groups?.size ? [match.groups.size] : [];
  });
};

/**
 * The status region dnd-kit writes each drag event into. The screen holds
 * other status regions, so it is found by the one attribute dnd-kit gives it
 * alone.
 */
const announcement = (page: Page): Locator =>
  page.locator('[role="status"][id^="dnd-kit-announcement"]');

/** The role names, in the order the author roles page lists them. */
const creatorRoleNamesInOrder = async (page: Page): Promise<string[]> => {
  const fields = await page
    .getByRole("list", { exact: true, name: "Author roles" })
    .getByRole("textbox")
    .all();
  return await Promise.all(fields.map((field) => field.inputValue()));
};

/** Register an author role from the `/creator-roles` create form. */
const createCreatorRoleViaUi = async (
  page: Page,
  name: string
): Promise<void> => {
  await page.goto(adminUrl("/creator-roles"));
  await fillField(page.getByRole("textbox", { name: /Role name/u }), name);
  await page.getByRole("button", { name: "Create role" }).click();
  await expect(
    page.getByRole("textbox", { exact: true, name: `Name of ${name}` })
  ).toBeVisible({ timeout: 15_000 });
};

/**
 * Every reorderable list in the console, driven from the keyboard.
 *
 * The console orders each of them with a dnd-kit sortable list, so a handle
 * picks a row up, an arrow moves it, and a second press drops it. The keyboard
 * is what is asserted rather than a pointer drag: it is the path a list of
 * drag handles is most likely to lose, and a press lands the same way on every
 * runner.
 *
 * Each test makes its own rows with a per-run suffix and `afterEach` deletes
 * them, so `task e2e:test` against a long-lived stack does not accumulate
 * them — and nothing here moves a row the rest of the suite reads.
 */
test.describe("admin list reordering", () => {
  let createdSeriesIds: string[] = [];
  let createdCreatorRoleNames: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdSeriesIds = [];
    createdCreatorRoleNames = [];
    await signInAsSeedAdmin(page);
  });

  test.afterEach(() => {
    deleteSeriesByPublicIds(createdSeriesIds);
    deleteCreatorRolesByNames(createdCreatorRoleNames);
    createdSeriesIds = [];
    createdCreatorRoleNames = [];
  });

  const trackSeries = (publicId: string): string => {
    createdSeriesIds.push(publicId);
    return publicId;
  };

  test("moves an episode up the series list and stores the new order", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const seriesId = trackSeries(
      await createSeriesViaUi(page, {
        synopsis: `E2E reorder synopsis ${suffix}`,
        title: `E2E Reorder Series ${suffix}`,
      })
    );
    const first = `E2E Episode A ${suffix}`;
    const second = `E2E Episode B ${suffix}`;
    await createEpisodeViaUi(page, { seriesPublicId: seriesId, title: first });
    await createEpisodeViaUi(page, { seriesPublicId: seriesId, title: second });

    await page.goto(adminUrl(`/series/${seriesId}/episodes`));
    await expect(episodeHandle(page, second)).toBeVisible();
    expect(await episodeTitlesInOrder(page, [first, second])).toEqual([
      first,
      second,
    ]);

    // The list rearranges itself the moment the row is dropped, and a reorder
    // puts nothing else on screen, so the flip below says nothing about whether
    // the Action behind it has even been sent. Waiting for its answer is what
    // keeps the reload from cancelling the write it is about to read.
    const reordered = serverActionAnswered(page);
    await reorderWithKeyboard(page, `Reorder ${second}`, "ArrowUp");
    await reordered;

    await expect
      .poll(async () => await episodeTitlesInOrder(page, [first, second]))
      .toEqual([second, first]);

    // The order is the series' own, not this page's: reloading reads it back
    // from the API rather than from the list the keyboard rearranged.
    await page.reload();
    await expect(episodeHandle(page, second)).toBeVisible();
    expect(await episodeTitlesInOrder(page, [first, second])).toEqual([
      second,
      first,
    ]);
  });

  test("moves a page image ahead of the one before it", async ({ page }) => {
    const suffix = uniqueSuffix();
    const seriesId = trackSeries(
      await createSeriesViaUi(page, {
        synopsis: `E2E page reorder synopsis ${suffix}`,
        title: `E2E Page Reorder Series ${suffix}`,
      })
    );
    const episodeId = await createEpisodeViaUi(page, {
      seriesPublicId: seriesId,
      title: `E2E Page Reorder Episode ${suffix}`,
    });

    // Two pages of different shapes, so the size in each caption says which
    // image a row is holding once the positions have moved.
    await page.goto(adminUrl(`/series/${seriesId}/episodes/${episodeId}`));
    await page
      .locator('input[name="pages"]')
      .setInputFiles([
        EYE_CATCH_ASPECT_FIXTURES.portrait,
        EYE_CATCH_ASPECT_FIXTURES.landscape,
      ]);
    await page.getByRole("button", { name: "Add page images" }).click();
    await expect(page.getByText("Page images added.")).toBeVisible({
      timeout: 60_000,
    });

    const uploaded = await imageSizesInOrder(page);
    expect(uploaded).toHaveLength(2);
    expect(new Set(uploaded).size, uploaded.join(" / ")).toBe(2);

    // The grid lays the pages out in rows, so the second one sits to the right
    // of the first and the arrow that moves it is the horizontal one.
    const reordered = serverActionAnswered(page);
    await reorderWithKeyboard(page, "Reorder page 2", "ArrowLeft");
    await reordered;

    await expect
      .poll(async () => await imageSizesInOrder(page))
      .toEqual([uploaded[1], uploaded[0]]);

    await page.reload();
    await expect
      .poll(async () => await imageSizesInOrder(page))
      .toEqual([uploaded[1], uploaded[0]]);
  });

  test("moves an author role up the priority order", async ({ page }) => {
    const suffix = uniqueSuffix();
    const first = `E2E Role A ${suffix}`;
    const second = `E2E Role B ${suffix}`;
    createdCreatorRoleNames.push(first, second);
    await createCreatorRoleViaUi(page, first);
    await createCreatorRoleViaUi(page, second);

    // A new role goes to the end of the priority order, so the second one is
    // below the first. The tenant already has roles, so it is their relative
    // order that is asserted rather than the whole list.
    const created = await creatorRoleNamesInOrder(page);
    expect(created.indexOf(first)).toBeLessThan(created.indexOf(second));

    const reordered = serverActionAnswered(page);
    await reorderWithKeyboard(page, `Reorder ${second}`, "ArrowUp");
    await reordered;

    await expect
      .poll(async () => {
        const names = await creatorRoleNamesInOrder(page);
        return names.indexOf(second) < names.indexOf(first);
      })
      .toBe(true);

    await page.reload();
    await expect(
      page.getByRole("textbox", { exact: true, name: `Name of ${second}` })
    ).toBeVisible();
    const reloaded = await creatorRoleNamesInOrder(page);
    expect(reloaded.indexOf(second)).toBeLessThan(reloaded.indexOf(first));
  });

  // dnd-kit speaks through a hidden description the handle points at and a
  // status region it writes on each drag event, both outside the list itself.
  // Switching language on the same screen is what proves the copy follows the
  // locale rather than whatever the list was first built with.
  test("speaks a drag in the console's language and by the row's name", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Spoken Role ${suffix}`;
    createdCreatorRoleNames.push(name);
    await createCreatorRoleViaUi(page, name);

    const englishHandle = page.getByRole("button", {
      exact: true,
      name: `Reorder ${name}`,
    });
    await expect(englishHandle).toHaveAccessibleDescription(
      /^To pick up a row, press Space or Enter\./u
    );
    await expect(englishHandle).toHaveAttribute(
      "aria-roledescription",
      "draggable"
    );

    // A new role goes to the end of the priority order, so the one above it
    // is where an arrow up takes it.
    await englishHandle.focus();
    await page.keyboard.press("Space");
    await expect(announcement(page)).toHaveText(
      new RegExp(`^Picked up ${name} at position \\d+\\.$`, "u")
    );
    const pickedUpText = await announcement(page).textContent();
    const pickedUp = Number(pickedUpText?.match(/\d+(?=\.$)/u)?.[0]);
    await page.keyboard.press("ArrowUp");
    await expect(announcement(page)).toHaveText(
      `${name} moved to position ${pickedUp - 1}.`
    );
    await page.keyboard.press("Escape");
    await expect(announcement(page)).toHaveText(
      `Move cancelled. ${name} returned to position ${pickedUp}.`
    );

    await switchConsoleLocale(page, "English", "日本語");

    const japaneseHandle = page.getByRole("button", {
      exact: true,
      name: `${name} を並べ替え`,
    });
    await expect(japaneseHandle).toHaveAccessibleDescription(
      /^行を持ち上げるには Space キーまたは Enter キーを押します。/u
    );
    await expect(japaneseHandle).toHaveAttribute(
      "aria-roledescription",
      "ドラッグ可能"
    );

    await japaneseHandle.focus();
    await page.keyboard.press("Space");
    await expect(announcement(page)).toHaveText(
      new RegExp(`^${name}を持ち上げました。現在 \\d+ 番目です。$`, "u")
    );
  });
});
