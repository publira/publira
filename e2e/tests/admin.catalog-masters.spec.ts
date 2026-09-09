import { createHash } from "node:crypto";

import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  createCreatorViaUi,
  createGenreViaUi,
  createLabelViaUi,
  createSeriesViaUi,
  creatorFormFields,
  fillField,
  formMessage,
  genreCreateField,
  genreNameField,
  genreNamesInOrder,
  genreRow,
  labelFormFields,
  seriesFormFields,
  signInAsSeedAdmin,
} from "../src/admin";
import {
  applyScenarioSql,
  assignGenreToSeries,
  deleteCreatorsByPublicIds,
  deleteGenresByNames,
  deleteLabelsByPublicIds,
  deleteSeriesByPublicIds,
} from "../src/db";
import {
  publishedAtOneHourAgo,
  uniqueSuffix,
} from "../src/scenarios/admin-publish";
import { EYE_CATCH_SOURCE_FIXTURE } from "../src/scenarios/eye-catch";
import {
  MULTI_TENANT_SCENARIO,
  OTHER_TENANT,
} from "../src/scenarios/multi-tenant";
import {
  hostPath,
  WEB_ADMIN_BASE_URL,
  WEB_HOST_BASE_URL,
  WEB_HOST_EDGE_BASE_URL,
} from "../src/urls";

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

/**
 * Where in the upload the editor leaves the frame. `centred` is where the
 * dialog opens it, which is the square the API cuts on its own.
 */
type IconFraming = "centred" | "off-centre";

/**
 * The path the reader's origin serves the saved icon from.
 *
 * The console renders it through `next/image`, so what the console shows is an
 * optimizer request carrying that path as its `url` parameter.
 */
const savedIconPath = async (page: Page): Promise<string> => {
  const src = await page
    .getByAltText("Current author icon")
    .getAttribute("src", { timeout: 30_000 });
  const url = new URL(src ?? "", WEB_ADMIN_BASE_URL);
  return url.searchParams.get("url") ?? url.pathname;
};

/**
 * Upload an author icon from the edit form and return the sha256 of the image
 * the reader's origin ends up serving.
 *
 * Choosing a file opens the crop dialog, so framing is part of choosing and the
 * dialog has to be closed before the form's own button is reachable again. The
 * frame is moved by its keyboard step rather than by dragging: a press lands
 * the same way on every runner, and it is the accessible path through the
 * control besides.
 */
const uploadIcon = async (
  page: Page,
  request: APIRequestContext,
  creatorPublicId: string,
  framing: IconFraming
): Promise<string> => {
  await page.goto(adminUrl(`/creators/${creatorPublicId}`));
  // Choosing a file is answered by React, so the pick is repeated until the
  // dialog it opens is on screen: a file set before the form has hydrated
  // reaches the input and nothing else, the same race the locale switcher
  // retries past. The input is emptied first, so every attempt is a change
  // rather than the same file set over itself.
  const iconInput = page.locator('input[name="icon_image"]');
  await expect(async () => {
    await iconInput.setInputFiles([]);
    await iconInput.setInputFiles(EYE_CATCH_SOURCE_FIXTURE);
    await expect(
      page.getByRole("heading", { name: "Frame the author icon" })
    ).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  if (framing === "off-centre") {
    await page
      .getByRole("button", { name: "Move the crop frame" })
      .press("Shift+ArrowUp");
  }
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Update author" }).click();
  await expect(formMessage(page)).toContainText("Author updated.");

  // Read the saved icon from a fresh load rather than from the form the Action
  // just re-rendered, so what is measured is what the console serves on the
  // next visit.
  await page.goto(adminUrl(`/creators/${creatorPublicId}`));
  const path = await savedIconPath(page);
  // Only the Traefik edge joins web-host and image-server under one host and
  // port, so the console names the path and the bytes are read from the edge.
  const response = await request.get(`${WEB_HOST_EDGE_BASE_URL}${path}`);
  expect(response.status(), path).toBe(200);
  return createHash("sha256")
    .update(await response.body())
    .digest("hex");
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
  /** Genres are addressed by name: the console never shows their public id. */
  let createdGenreNames: string[] = [];

  test.beforeEach(async ({ page }) => {
    createdSeriesIds = [];
    createdCreatorIds = [];
    createdLabelIds = [];
    createdGenreNames = [];
    await signInAsSeedAdmin(page);
  });

  test.afterEach(() => {
    // Series first: it is what holds the creator and the label in use.
    deleteSeriesByPublicIds(createdSeriesIds);
    deleteCreatorsByPublicIds(createdCreatorIds);
    deleteLabelsByPublicIds(createdLabelIds);
    deleteGenresByNames(createdGenreNames);
    createdSeriesIds = [];
    createdCreatorIds = [];
    createdLabelIds = [];
    createdGenreNames = [];
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

  /**
   * Register a genre and remember it for the cleanup.
   *
   * The cleanup matches on the name, so a test that renames a genre tracks the
   * new name as well — whichever one the row ends up holding is the one that
   * has to be deleted.
   */
  const trackGenre = async (page: Page, name: string): Promise<string> => {
    createdGenreNames.push(name);
    await createGenreViaUi(page, name);
    return name;
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
    await page.getByRole("button", { name: "Update author" }).click();
    await expect(formMessage(page)).toContainText("Author updated.");

    // The saved edit reaches the public page without waiting for an expiry.
    await pollHostPage(page, hostUrl(`/authors/${creatorId}`), () =>
      mainHeadingText(page)
    ).toBe(renamed);
    await expect(page.getByText(editedProfileText)).toBeVisible();
  });

  test("framing an author icon cuts the square where the editor put it", async ({
    page,
    request,
  }) => {
    const name = `E2E Icon Author ${uniqueSuffix()}`;
    const creatorPublicId = trackCreator(
      await createCreatorViaUi(page, { name })
    );

    const centred = await uploadIcon(page, request, creatorPublicId, "centred");
    const framed = await uploadIcon(
      page,
      request,
      creatorPublicId,
      "off-centre"
    );

    // Same file and the same square: only the rectangle the editor framed
    // separates the two.
    expect(framed).not.toBe(centred);
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
    await page.getByRole("button", { name: "Update label" }).click();
    await expect(formMessage(page)).toContainText("Label updated.");

    // As with a creator, the saved edit reaches the storefront rather than
    // leaving the previous name on it.
    await pollHostPage(page, hostUrl(`/labels/${labelId}`), () =>
      mainHeadingText(page)
    ).toBe(renamed);
  });

  test("registers genres at the end of the list and moves one up", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const first = await trackGenre(page, `E2E Genre A ${suffix}`);
    const second = await trackGenre(page, `E2E Genre B ${suffix}`);

    // A new genre lands at the end, so the second one is below the first. The
    // tenant may already have genres, so it is their relative order that is
    // asserted rather than the whole list.
    const created = await genreNamesInOrder(page);
    expect(created.indexOf(first)).toBeLessThan(created.indexOf(second));

    await page
      .getByRole("button", { exact: true, name: `Move ${second} up` })
      .click();

    await expect
      .poll(async () => {
        const names = await genreNamesInOrder(page);
        return names.indexOf(second) < names.indexOf(first);
      })
      .toBe(true);

    // The order is the tenant's own, not this page's: reloading reads it back
    // from the API rather than from the list the button rearranged.
    await page.reload();
    await expect(genreNameField(page, second)).toBeVisible();
    const reloaded = await genreNamesInOrder(page);
    expect(reloaded.indexOf(second)).toBeLessThan(reloaded.indexOf(first));
  });

  test("renames a genre and refuses a name another genre already holds", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const taken = await trackGenre(page, `E2E Genre Taken ${suffix}`);
    const original = await trackGenre(page, `E2E Genre Rename ${suffix}`);

    const row = genreRow(page, original);
    await fillField(genreNameField(page, original), taken);
    await row.getByRole("button", { exact: true, name: "Save" }).click();
    await expect(row.getByRole("status")).toContainText(
      "A genre with this name already exists."
    );
    // The field goes back to the name the genre still has: nothing was saved,
    // and a field left holding a rejected name would read as if it had been.
    await expect(genreNameField(page, original)).toHaveValue(original);

    const renamed = `${original} (renamed)`;
    createdGenreNames.push(renamed);
    await fillField(genreNameField(page, original), renamed);
    await row.getByRole("button", { exact: true, name: "Save" }).click();
    // The row is addressed by the saved name, so a successful rename is what
    // moves the message from the old row locator to the new one.
    await expect(genreNameField(page, renamed)).toBeVisible();
    await expect(genreRow(page, renamed).getByRole("status")).toContainText(
      "Genre updated."
    );
  });

  test("deletes an unused genre and refuses one a series still carries", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const assigned = await trackGenre(page, `E2E Genre Used ${suffix}`);
    const unused = await trackGenre(page, `E2E Genre Unused ${suffix}`);

    const seriesId = trackSeries(
      await createSeriesViaUi(page, {
        synopsis: `E2E genre series synopsis ${suffix}`,
        title: `E2E Genre Series ${suffix}`,
      })
    );
    assignGenreToSeries(seriesId, assigned);

    await page.goto(adminUrl("/genres"));
    const assignedRow = genreRow(page, assigned);
    await assignedRow
      .getByRole("button", { exact: true, name: "Delete" })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { exact: true, name: "Delete" })
      .click();
    await expect(assignedRow.getByRole("status")).toContainText(
      "Remove it from every series before deleting it."
    );
    await expect(genreNameField(page, assigned)).toBeVisible();

    // The same button on a genre nothing carries takes the row away.
    await genreRow(page, unused)
      .getByRole("button", { exact: true, name: "Delete" })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { exact: true, name: "Delete" })
      .click();
    await expect(genreNameField(page, unused)).toHaveCount(0);
  });

  test("a genre with no name shows the error instead of submitting", async ({
    page,
  }) => {
    await page.goto(adminUrl("/genres"));
    const field = genreCreateField(page);

    // The control is `required`, so the browser refuses to submit and the
    // Action never runs — the same path the creator and label forms take.
    await page.getByRole("button", { name: "Create genre" }).click();
    await expect(formMessage(page)).toHaveCount(0);

    // Blanks satisfy the browser; the Action trims before it validates.
    await fillField(field, "   ");
    await page.getByRole("button", { name: "Create genre" }).click();
    await expect(formMessage(page)).toContainText(/Genre name is required/u);
  });

  test("a creator with no name shows the error instead of submitting", async ({
    page,
  }) => {
    await page.goto(adminUrl("/creators/new"));
    const fields = creatorFormFields(page);

    // The control is `required`, so the browser refuses to submit: the Action
    // never runs, nothing comes back to report, and the form stays put.
    await page.getByRole("button", { name: "Create author" }).click();
    await expect(formMessage(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/creators\/new/u);

    // Blanks satisfy the browser; the Action trims before it validates, so
    // this is the path that shows the console's own message.
    await fillField(fields.name, "   ");
    await page.getByRole("button", { name: "Create author" }).click();
    await expect(formMessage(page)).toContainText(/Name is required/u);
    await expect(page).toHaveURL(/\/creators\/new/u);
  });

  test("a label with no name shows the error instead of submitting", async ({
    page,
  }) => {
    await page.goto(adminUrl("/labels/new"));
    const fields = labelFormFields(page);

    await page.getByRole("button", { name: "Create label" }).click();
    await expect(formMessage(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/labels\/new/u);

    await fillField(fields.name, "   ");
    await page.getByRole("button", { name: "Create label" }).click();
    await expect(formMessage(page)).toContainText(/Label name is required/u);
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
      page.getByText(/Page not found|Could not display the author/u)
    ).toBeVisible();
    await expect(page.getByText(OTHER_TENANT.authorName)).toHaveCount(0);
    await expect(creatorFormFields(page).name).toHaveCount(0);

    const labelResponse = await page.goto(
      adminUrl(`/labels/${OTHER_TENANT.labelId}`)
    );
    expect(labelResponse?.status(), await page.content()).toBe(200);
    await expect(
      page.getByText(/Page not found|Could not display the label/u)
    ).toBeVisible();
    await expect(page.getByText(OTHER_TENANT.labelName)).toHaveCount(0);
    await expect(labelFormFields(page).name).toHaveCount(0);
  });
});
