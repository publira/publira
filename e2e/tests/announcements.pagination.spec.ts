import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  MEMBER_ANNOUNCEMENTS,
  MEMBER_ANNOUNCEMENTS_SCENARIO,
  SEED_MEMBER,
} from "../src/scenarios/member-announcements";

/** Keep in sync with `ANNOUNCEMENTS_PAGE_SIZE` in the web-host announcements page. */
const ANNOUNCEMENTS_PAGE_SIZE = 20;

const signIn = async (page: Page): Promise<void> => {
  await page.goto("/login?returnTo=%2Fannouncements");
  await page.getByLabel(/メールアドレス/u).fill(SEED_MEMBER.email);
  await page.getByLabel(/パスワード/u).fill(SEED_MEMBER.password);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/announcements/u);
};

const pagination = (page: Page) =>
  page.getByRole("navigation", { name: "お知らせ一覧ページング" });

const noticeTitles = (page: Page) =>
  page.locator("article h3").allTextContents();

/**
 * Follow a page link and wait for the move to land. Two separate signals have to
 * settle: the `token` in the URL, and the rows themselves. Neighbouring pages
 * hold the same number of rows, so a count assertion alone is satisfied by the
 * page still on screen — and the list renders behind Suspense, so the URL can
 * change while the previous page's rows are still mounted. Every move in this
 * suite crosses a page boundary, so the leading title is what proves it landed.
 */
const movePage = async (page: Page, label: string): Promise<void> => {
  const fromUrl = page.url();
  const fromLeadingTitle = await page
    .locator("article h3")
    .first()
    .textContent();

  await pagination(page).getByRole("link", { name: label }).click();

  await page.waitForURL((url) => url.toString() !== fromUrl);
  await expect(page.locator("article h3").first()).not.toHaveText(
    fromLeadingTitle ?? ""
  );
};

/**
 * The signed-in member's announcement list under cursor pagination (#717). The
 * list streams in behind Suspense, so every assertion targets resolved content
 * rather than the skeleton, and page moves go through `movePage` so the rows
 * are known to have caught up with the URL.
 */
test.describe("web-host member announcements", () => {
  test.beforeAll(() => {
    applyScenarioSql(MEMBER_ANNOUNCEMENTS_SCENARIO);
  });

  test("お知らせ一覧を cursor でページ送りできる", async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/announcements/u);

    const notices = page.locator("article h3");
    await expect(notices).toHaveCount(ANNOUNCEMENTS_PAGE_SIZE);

    // Newest first, and nothing before the first page.
    await expect(notices.first()).toHaveText(MEMBER_ANNOUNCEMENTS.newestTitle);
    await expect(
      pagination(page).getByRole("link", { name: "前のページ" })
    ).toHaveCount(0);
    const firstPage = await noticeTitles(page);

    await movePage(page, "次のページ");
    await expect(page).toHaveURL(/\?token=/u);
    await expect(notices).toHaveCount(ANNOUNCEMENTS_PAGE_SIZE);
    const secondPage = await noticeTitles(page);

    // No row is repeated across the page boundary.
    expect(secondPage.filter((title) => firstPage.includes(title))).toEqual([]);

    await movePage(page, "次のページ");
    await expect(notices).toHaveCount(
      MEMBER_ANNOUNCEMENTS.count - 2 * ANNOUNCEMENTS_PAGE_SIZE
    );
    const lastPage = await noticeTitles(page);

    expect(lastPage.filter((title) => secondPage.includes(title))).toEqual([]);
    await expect(notices.last()).toHaveText(MEMBER_ANNOUNCEMENTS.oldestTitle);
    // Nothing after the last page.
    await expect(
      pagination(page).getByRole("link", { name: "次のページ" })
    ).toHaveCount(0);

    // Every seeded row was reachable across the three pages.
    expect(new Set([...firstPage, ...secondPage, ...lastPage]).size).toBe(
      MEMBER_ANNOUNCEMENTS.count
    );

    // `前のページ` walks back to the same rows, not to a shifted window.
    await movePage(page, "前のページ");
    await expect(notices).toHaveCount(ANNOUNCEMENTS_PAGE_SIZE);
    await expect(noticeTitles(page)).resolves.toEqual(secondPage);

    await movePage(page, "前のページ");
    await expect(notices).toHaveCount(ANNOUNCEMENTS_PAGE_SIZE);
    await expect(noticeTitles(page)).resolves.toEqual(firstPage);
  });

  test("先頭以外のページから遷移先を開いて既読にできる", async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/announcements/u);

    await movePage(page, "次のページ");
    await expect(page).toHaveURL(/\?token=/u);
    const secondPageUrl = page.url();

    const opened =
      (await page.locator("article h3").first().textContent()) ?? "";
    expect(opened).not.toBe("");
    await page
      .locator("article")
      .first()
      .getByRole("button", { name: "開いて既読にする" })
      .click();
    await expect(page).toHaveURL(/\/series$/u);

    // Back on the same page of the list, that row is now 既読.
    await page.goto(secondPageUrl);
    const readNotice = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { level: 3, name: opened }) });
    await expect(readNotice.getByText("既読")).toBeVisible();
  });

  test("壊れた token は先頭ページに落とす", async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/announcements/u);
    await expect(page.locator("article h3")).toHaveCount(
      ANNOUNCEMENTS_PAGE_SIZE
    );

    await page.goto("/announcements?token=not%20a%20token");

    await expect(page.locator("article h3")).toHaveCount(
      ANNOUNCEMENTS_PAGE_SIZE
    );
    await expect(page.locator("article h3").first()).toHaveText(
      MEMBER_ANNOUNCEMENTS.newestTitle
    );
    await expect(
      pagination(page).getByRole("link", { name: "前のページ" })
    ).toHaveCount(0);
  });
});
