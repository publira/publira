import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  createCreatorViaUi,
  createLabelViaUi,
  createSeriesViaUi,
  creatorFormFields,
  fillField,
  formMessage,
  labelFormFields,
  seriesFormFields,
  signInAsSeedAdmin,
} from "../src/admin";
import {
  applyScenarioSql,
  deleteCreatorsByPublicIds,
  deleteLabelsByPublicIds,
  deleteSeriesByPublicIds,
} from "../src/db";
import {
  publishedAtOneHourAgo,
  uniqueSuffix,
} from "../src/scenarios/admin-publish";
import {
  MULTI_TENANT_SCENARIO,
  OTHER_TENANT,
} from "../src/scenarios/multi-tenant";
import { hostPath, WEB_ADMIN_BASE_URL, WEB_HOST_BASE_URL } from "../src/urls";

const hostUrl = (pathname: string): string =>
  `${WEB_HOST_BASE_URL}${hostPath(pathname)}`;

const adminUrl = (pathname: string): string =>
  `${WEB_ADMIN_BASE_URL}${pathname}`;

/**
 * Read a web-host page again and again until it reports what the console just
 * saved.
 *
 * An admin write revalidates the tags web-host holds its cached reads under,
 * and revalidation marks those entries stale rather than dropping them: the
 * request right after the write is still answered from the stale entry while
 * the refresh runs behind it, and the request after that carries the new
 * value. Waiting on a single navigation would be waiting on a copy that can
 * never change, so these assertions navigate again instead.
 */
const pollHostPage = <T>(page: Page, url: string, read: () => Promise<T>) =>
  expect.poll(
    async () => {
      await page.goto(url);
      return await read();
    },
    { message: `${url} never caught up with the console`, timeout: 30_000 }
  );

/** Text of the page heading, once the section behind Suspense has resolved. */
const mainHeadingText = async (page: Page): Promise<string> => {
  const heading = page.getByRole("heading", { level: 1 }).first();
  const text = await heading.textContent({ timeout: 15_000 });
  return text?.trim() ?? "";
};

/** The public label list's card for one label, by the name on its heading. */
const labelCard = (page: Page, name: string): Locator =>
  page.getByRole("link").filter({
    has: page.getByRole("heading", { level: 2, name }),
  });

/**
 * The creator and label masters a tenant admin maintains beside the series
 * they are attached to: the console screens that write them, and the public
 * pages each one feeds.
 *
 * Every record is created through the console with a unique name, so a re-run
 * never depends on a row a previous run left behind, and `afterEach` deletes
 * what the test made so `task e2e:test` against a long-lived stack does not
 * accumulate rows.
 */
test.describe("admin catalog masters", () => {
  /** public_ids created in the current test; drained by afterEach. */
  let createdSeriesIds: string[] = [];
  let createdCreatorIds: string[] = [];
  let createdLabelIds: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdSeriesIds = [];
    createdCreatorIds = [];
    createdLabelIds = [];
    await signInAsSeedAdmin(page);
  });

  test.afterEach(() => {
    // Series first: it is what holds the creator and the label in use.
    deleteSeriesByPublicIds(createdSeriesIds);
    deleteCreatorsByPublicIds(createdCreatorIds);
    deleteLabelsByPublicIds(createdLabelIds);
    createdSeriesIds = [];
    createdCreatorIds = [];
    createdLabelIds = [];
  });

  const trackSeries = (publicId: string): string => {
    createdSeriesIds.push(publicId);
    return publicId;
  };

  const trackCreator = (publicId: string): string => {
    createdCreatorIds.push(publicId);
    return publicId;
  };

  const trackLabel = (publicId: string): string => {
    createdLabelIds.push(publicId);
    return publicId;
  };

  test("registers a creator and offers it in the list and the series picker", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Creator ${suffix}`;
    const profileText = `E2E creator profile ${suffix}`;

    const creatorId = trackCreator(
      await createCreatorViaUi(page, { name, profileText })
    );

    await expect(page).toHaveURL(new RegExp(`/creators/${creatorId}`, "u"));
    const fields = creatorFormFields(page);
    await expect(fields.name).toHaveValue(name);
    await expect(fields.profileText).toHaveValue(profileText);

    // Console list: newest first, so a creator just made is on the first page.
    await page.goto(adminUrl("/creators"));
    await expect(page.getByRole("cell", { name })).toBeVisible();

    // The series form's picker reads the same tenant creator list, so a
    // creator is attachable to a series as soon as it is registered.
    await page.goto(adminUrl("/series/new"));
    const { creatorCombobox } = seriesFormFields(page);
    await creatorCombobox.click();
    await creatorCombobox.fill(name);
    await expect(page.getByRole("option", { name })).toBeVisible();
  });

  test("editing a creator reaches the author detail page on web-host", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Author ${suffix}`;
    const profileText = `E2E author profile ${suffix}`;
    const creatorId = trackCreator(
      await createCreatorViaUi(page, { name, profileText })
    );

    // A creator reaches the public site only through a published series: the
    // author pages list creators that have at least one (see
    // GetPublishedAuthorByPublicID). Past wall clock → published on create.
    const seriesTitle = `E2E Author Series ${suffix}`;
    trackSeries(
      await createSeriesViaUi(page, {
        creatorName: name,
        publishedAt: publishedAtOneHourAgo(),
        synopsis: `E2E author series synopsis ${suffix}`,
        title: seriesTitle,
      })
    );

    // Brand-new public_id: this first host request misses cache and hits the
    // public API, so nothing older than the series can be served here.
    const response = await page.goto(hostUrl(`/authors/${creatorId}`));
    expect(response?.status(), await page.content()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText(profileText)).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(seriesTitle, "u") }).first()
    ).toBeVisible();

    const renamed = `${name} (renamed)`;
    const editedProfileText = `${profileText} (edited)`;
    await page.goto(adminUrl(`/creators/${creatorId}`));
    const fields = creatorFormFields(page);
    await expect(fields.name).toHaveValue(name);
    await fillField(fields.name, renamed);
    await fillField(fields.profileText, editedProfileText);
    await page.getByRole("button", { name: "著者を更新" }).click();
    await expect(formMessage(page)).toContainText("著者を更新しました。");

    // The saved edit reaches the public page without waiting for an expiry.
    await pollHostPage(page, hostUrl(`/authors/${creatorId}`), () =>
      mainHeadingText(page)
    ).toBe(renamed);
    await expect(page.getByText(editedProfileText)).toBeVisible();
  });

  test("registers a label and shows it in the list and on web-host", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Label ${suffix}`;

    const labelId = trackLabel(await createLabelViaUi(page, name));

    await expect(page).toHaveURL(new RegExp(`/labels/${labelId}`, "u"));
    await expect(labelFormFields(page).name).toHaveValue(name);

    await page.goto(adminUrl("/labels"));
    await expect(page.getByRole("cell", { name })).toBeVisible();

    // A label is public in its own right — it does not need a series — and the
    // public list is newest first, so a label just made is on the first page.
    await pollHostPage(page, hostUrl("/labels"), async () => {
      // Every card is one `<h2>`; wait for the list before counting in it.
      await page
        .getByRole("heading", { level: 2 })
        .first()
        .waitFor({ state: "attached", timeout: 15_000 });
      return await labelCard(page, name).count();
    }).toBe(1);
    await labelCard(page, name).click();

    await expect(page).toHaveURL(new RegExp(`/labels/${labelId}$`, "u"));
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  });

  test("editing a label reaches label detail on web-host", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Label ${suffix}`;
    const labelId = trackLabel(await createLabelViaUi(page, name));

    // Brand-new public_id: the first host request cannot be served from cache.
    const response = await page.goto(hostUrl(`/labels/${labelId}`));
    expect(response?.status(), await page.content()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

    const renamed = `${name} (renamed)`;
    await page.goto(adminUrl(`/labels/${labelId}`));
    const fields = labelFormFields(page);
    await expect(fields.name).toHaveValue(name);
    await fillField(fields.name, renamed);
    await page.getByRole("button", { name: "レーベルを更新" }).click();
    await expect(formMessage(page)).toContainText("レーベルを更新しました。");

    // As with a creator, the saved edit reaches the storefront rather than
    // leaving the previous name on it.
    await pollHostPage(page, hostUrl(`/labels/${labelId}`), () =>
      mainHeadingText(page)
    ).toBe(renamed);
  });

  test("a creator with no name shows the error instead of submitting", async ({
    page,
  }) => {
    await page.goto(adminUrl("/creators/new"));
    const fields = creatorFormFields(page);

    // The control is `required`, so the browser refuses to submit: the Action
    // never runs, nothing comes back to report, and the form stays put.
    await page.getByRole("button", { name: "著者を作成" }).click();
    await expect(formMessage(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/creators\/new/u);

    // Blanks satisfy the browser; the Action trims before it validates, so
    // this is the path that shows the console's own message.
    await fillField(fields.name, "   ");
    await page.getByRole("button", { name: "著者を作成" }).click();
    await expect(formMessage(page)).toContainText(/名前は必須/u);
    await expect(page).toHaveURL(/\/creators\/new/u);
  });

  test("a label with no name shows the error instead of submitting", async ({
    page,
  }) => {
    await page.goto(adminUrl("/labels/new"));
    const fields = labelFormFields(page);

    await page.getByRole("button", { name: "レーベルを作成" }).click();
    await expect(formMessage(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/labels\/new/u);

    await fillField(fields.name, "   ");
    await page.getByRole("button", { name: "レーベルを作成" }).click();
    await expect(formMessage(page)).toContainText(/レーベル名は必須/u);
    await expect(page).toHaveURL(/\/labels\/new/u);
  });

  test("another tenant's creator and label are not found in the edit screens", async ({
    page,
  }) => {
    applyScenarioSql(MULTI_TENANT_SCENARIO);

    const creatorResponse = await page.goto(
      adminUrl(`/creators/${OTHER_TENANT.authorId}`)
    );
    // Cache Components commits the shell with 200. The resource itself is
    // either the console not-found page or an inline load error — never the
    // foreign creator's form (see (protected)/not-found.tsx and getCreator).
    expect(creatorResponse?.status(), await page.content()).toBe(200);
    await expect(
      page.getByText(/ページが見つかりません|著者を表示できませんでした/u)
    ).toBeVisible();
    await expect(page.getByText(OTHER_TENANT.authorName)).toHaveCount(0);
    await expect(creatorFormFields(page).name).toHaveCount(0);

    const labelResponse = await page.goto(
      adminUrl(`/labels/${OTHER_TENANT.labelId}`)
    );
    expect(labelResponse?.status(), await page.content()).toBe(200);
    await expect(
      page.getByText(/ページが見つかりません|レーベルを表示できませんでした/u)
    ).toBeVisible();
    await expect(page.getByText(OTHER_TENANT.labelName)).toHaveCount(0);
    await expect(labelFormFields(page).name).toHaveCount(0);
  });
});
