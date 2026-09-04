import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  createPageViaUi,
  fillField,
  pageFormFields,
  signInAsSeedAdmin,
} from "../src/admin";
import { applyScenarioSql, deletePagesByIds, runSql } from "../src/db";
import { uniqueSuffix } from "../src/scenarios/admin-publish";
import {
  MULTI_TENANT_SCENARIO,
  OTHER_TENANT,
} from "../src/scenarios/multi-tenant";
import { hostPath, WEB_ADMIN_BASE_URL, WEB_HOST_BASE_URL } from "../src/urls";

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

const hostUrl = (pathname: string): string =>
  `${WEB_HOST_BASE_URL}${hostPath(pathname)}`;

/**
 * One row of the workspace's version table, picked by its version cell so
 * `v1` cannot also select `v10`.
 */
const versionRow = (page: Page, versionNumber: number): Locator =>
  page.getByRole("row").filter({
    has: page.getByRole("cell", { exact: true, name: `v${versionNumber}` }),
  });

const versionStatus = (
  page: Page,
  versionNumber: number,
  label: string
): Locator => versionRow(page, versionNumber).getByText(label, { exact: true });

/** Publish one version from the workspace's version table. */
const publishVersion = async (
  page: Page,
  versionNumber: number
): Promise<void> => {
  await versionRow(page, versionNumber)
    .getByRole("button", { name: "公開する" })
    .click();
  await expect(versionStatus(page, versionNumber, "公開中")).toBeVisible({
    timeout: 30_000,
  });
};

/**
 * Read the public URL until it shows `title` as its heading.
 *
 * Publishing a version and renaming a page both drop the tenant's page cache
 * tags, and the admin API asks web-host to do that out of band from the
 * redirect the console has already followed. So the public read is a poll
 * rather than a single request after a fixed wait.
 */
const expectPublicPageHeading = async (
  page: Page,
  pathname: string,
  title: string
): Promise<void> => {
  await expect(async () => {
    await page.goto(hostUrl(pathname));
    await expect(
      page.getByRole("heading", { level: 1, name: title })
    ).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 60_000 });
};

/**
 * `/en` is the one slug in this suite that cannot carry a unique suffix: the
 * proxy only splits off a segment that is literally a locale code. A run killed
 * before its cleanup would leave the row behind and every later run would fail
 * on the slug conflict, so drop it before creating it.
 */
const deleteSeedTenantPageBySlug = (slug: string): void => {
  runSql(`
    DELETE FROM pages p
    USING tenants t
    WHERE p.tenant_id = t.id
      AND t.domain = 'localhost'
      AND p.slug = '${slug}';
  `);
};

/**
 * Published page management: the console screens under `/pages` and the public
 * page they put up at `/page/[...slug]` on the same tenant's web-host.
 *
 * `apps/web-host/lib/published-page-path.ts` and its unit test hold the
 * slug-matching rules; this is their end-to-end counterpart, not a replacement.
 *
 * Every page is created through the console with a unique slug and deleted in
 * `afterEach`, so `task e2e:test` against a long-lived stack neither depends on
 * nor accumulates rows.
 */
test.describe("admin published pages", () => {
  /** Page uuids created by the current test; drained by afterEach. */
  let createdPageIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdPageIds = [];
    await signInAsSeedAdmin(page, "/pages");
  });

  test.afterEach(() => {
    deletePagesByIds(createdPageIds);
    createdPageIds = [];
  });

  const trackPage = (pageId: string): string => {
    createdPageIds.push(pageId);
    return pageId;
  };

  test("creates a page as a draft the public site does not serve", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const slug = `/e2e-page-${suffix}`;
    const title = `E2E Draft Page ${suffix}`;

    const pageId = trackPage(
      await createPageViaUi(page, {
        contentMarkdown: `## 下書き\n\n下書き本文 ${suffix}`,
        slug,
        title,
      })
    );

    await expect(page).toHaveURL(new RegExp(`/pages/${pageId}`, "u"));
    await expect(versionStatus(page, 1, "下書き")).toBeVisible();

    // The list row says the same thing about the page it links to.
    await page.goto(adminUrl("/pages"));
    await expect(
      page
        .locator("tr", { hasText: title })
        .getByText("下書き", { exact: true })
    ).toBeVisible();

    const response = await page.goto(hostUrl(slug));
    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();
  });

  test("publishing a version makes the page reachable on the tenant's web-host", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const slug = `/e2e-page-${suffix}`;
    const title = `E2E Published Page ${suffix}`;
    const body = `公開本文 ${suffix}`;

    trackPage(
      await createPageViaUi(page, {
        contentMarkdown: `## 見出し\n\n${body}`,
        slug,
        title,
      })
    );

    await publishVersion(page, 1);

    await expectPublicPageHeading(page, slug, title);
    await expect(page.getByText(body)).toBeVisible();
  });

  test("editing the title and the body reaches the public page", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const slug = `/e2e-page-${suffix}`;
    const title = `E2E Edited Page ${suffix}`;
    const body = `初版本文 ${suffix}`;

    const pageId = trackPage(
      await createPageViaUi(page, {
        contentMarkdown: `## 初版\n\n${body}`,
        slug,
        title,
      })
    );

    await publishVersion(page, 1);
    await expectPublicPageHeading(page, slug, title);

    // The title lives on the page rather than on a version, so renaming it
    // changes the public page without publishing anything.
    const editedTitle = `${title} (edited)`;
    await page.goto(adminUrl(`/pages/${pageId}`));
    const titleField = page.getByRole("textbox", { name: "タイトル" });
    await fillField(titleField, editedTitle);
    await page.getByRole("button", { name: "タイトルを更新" }).click();
    // FlashToast strips `?updated=1` via a client replace; assert on the value
    // rather than waiting for a load event that may never re-fire.
    await expect(titleField).toHaveValue(editedTitle, { timeout: 30_000 });

    await expectPublicPageHeading(page, slug, editedTitle);

    // The body does live on a version: saving makes a draft, and only
    // publishing that draft moves the public page.
    const editedBody = `改訂本文 ${suffix}`;
    await page.goto(adminUrl(`/pages/${pageId}`));
    await fillField(
      page.getByRole("textbox", { name: "本文" }),
      `## 改訂\n\n${editedBody}`
    );
    await page.getByRole("button", { name: "この内容で下書きを保存" }).click();
    await expect(versionStatus(page, 2, "下書き")).toBeVisible({
      timeout: 30_000,
    });

    await page.goto(hostUrl(slug));
    await expect(page.getByText(body)).toBeVisible();
    await expect(page.getByText(editedBody)).toHaveCount(0);

    await page.goto(adminUrl(`/pages/${pageId}`));
    await publishVersion(page, 2);

    await expect(async () => {
      await page.goto(hostUrl(slug));
      await expect(page.getByText(editedBody)).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 60_000 });
    await expect(page.getByText(body)).toHaveCount(0);
  });

  test("a slug that collides with an existing page is refused", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const slug = `/e2e-page-${suffix}`;

    trackPage(
      await createPageViaUi(page, { slug, title: `E2E Slug Owner ${suffix}` })
    );

    await page.goto(adminUrl("/pages/new"));
    const fields = pageFormFields(page);
    await fillField(fields.slug, slug);
    await fillField(fields.title, `E2E Slug Duplicate ${suffix}`);
    await page.getByRole("button", { name: "ページを作成" }).click();

    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "同じ slug のページが既に存在します" })
    ).toBeVisible();
    // Still on the create form — no redirect, and no second page.
    await expect(page).toHaveURL(/\/pages\/new/u);
  });

  test("a slug that looks like a locale code still resolves as a public page", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const localeSlug = "/en";
    const title = `E2E Locale Slug Page ${suffix}`;
    const body = `ロケール風 slug の本文 ${suffix}`;

    deleteSeedTenantPageBySlug(localeSlug);
    trackPage(
      await createPageViaUi(page, {
        contentMarkdown: body,
        slug: localeSlug,
        title,
      })
    );
    await publishVersion(page, 1);

    // `/en` is the English home: the locale prefix is split off before the
    // published-page rules are consulted, and nothing is left to match a slug.
    const homeResponse = await page.goto(hostUrl(localeSlug));
    expect(homeResponse?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: title })
    ).toHaveCount(0);

    // `/en/en` is that same page, read under the English locale. This is what
    // `apps/web-host/proxy.ts` preserves by stripping the locale first.
    await expectPublicPageHeading(page, `${localeSlug}${localeSlug}`, title);
    await expect(page.getByText(body)).toBeVisible();
  });

  test("another tenant's page is not found in the edit screen", async ({
    page,
  }) => {
    applyScenarioSql(MULTI_TENANT_SCENARIO);

    const response = await page.goto(
      adminUrl(`/pages/${OTHER_TENANT.page.id}`)
    );
    // Cache Components commits the shell with 200. What renders below it is the
    // console not-found page, never the foreign page's workspace.
    expect(response?.status(), await page.content()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: "ページが見つかりません" })
    ).toBeVisible();
    await expect(page.getByText(OTHER_TENANT.page.title)).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "本文" })).toHaveCount(0);
  });
});
