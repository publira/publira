import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import {
  createSeriesViaUi,
  seriesFormFields,
  signInAsSeedAdmin,
} from "../src/admin";
import { deleteSeriesByPublicIds, querySql, quoteSqlLiteral } from "../src/db";
import {
  publishedAtOneHourAgo,
  uniqueSuffix,
} from "../src/scenarios/admin-publish";
import { SEED_TENANT_ID } from "../src/scenarios/auth";
import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import { hostPath, PUBLIC_API_BASE_URL, WEB_ADMIN_BASE_URL } from "../src/urls";

/**
 * Which engine the server searches with. `scripts/db-setup.sh` saves it from
 * `PUBLIRA_E2E_SEARCH_BACKEND`: `opensearch` under `task e2e:search`, `sql`
 * in every other run.
 */
const onOpenSearch = process.env.PUBLIRA_E2E_SEARCH_BACKEND === "opensearch";

/**
 * Wait until the public API's search for `query` answers with the series
 * `publicId`, or no longer does.
 *
 * Asked of the API rather than the storefront: on OpenSearch the worker writes
 * the document after the console's write has committed, and the engine shows
 * it to a search only once the index refreshes. A storefront search sent before
 * then is answered from the old index and held under `"use cache"`, and
 * nothing drops that entry when the document lands.
 */
const waitUntilSearchAnswers = async (
  query: string,
  publicId: string,
  found: boolean
): Promise<void> => {
  await expect
    .poll(
      async () => {
        const response = await fetch(
          `${PUBLIC_API_BASE_URL}/publira.v1.CatalogService/SearchPublishedSeries`,
          {
            body: JSON.stringify({
              limit: 20,
              query,
              surface: "CLIENT_SURFACE_WEB",
              tenant: { tenantId: SEED_TENANT_ID },
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }
        );
        expect(response.ok, await response.clone().text()).toBe(true);
        const { series = [] } = (await response.json()) as {
          series?: { publicId: string }[];
        };
        return series.some((item) => item.publicId === publicId);
      },
      {
        message: `the search for ${query} did not ${found ? "find" : "lose"} series ${publicId}`,
        timeout: 30_000,
      }
    )
    .toBe(found);
};

/**
 * Delete the index documents of the series `publicIds` name, before the rows
 * go. {@link deleteSeriesByPublicIds} drops the rows straight out of Postgres,
 * which queues none of the events that would write tombstones in their place,
 * so on a stack kept across runs every leftover document of a title this suite
 * reuses would rank level with the new one and push it off the first page.
 */
const deleteSeriesDocuments = async (
  publicIds: readonly string[]
): Promise<void> => {
  const url = process.env.PUBLIRA_E2E_OPENSEARCH_URL;
  if (!onOpenSearch || !url || publicIds.length === 0) {
    return;
  }
  const ids = querySql(`
    SELECT id FROM series
    WHERE public_id IN (${publicIds.map(quoteSqlLiteral).join(", ")})
  `)
    .split("\n")
    .filter(Boolean);
  // The alias `publiractl search set` saves when it is given none.
  const index = "publira-catalog";
  // The worker may still be rewriting one of them for an event a later write
  // queued, which the engine reports as a version conflict; the next attempt
  // deletes what that write left.
  await expect(async () => {
    const response = await fetch(
      `${url}/${index}/_delete_by_query?refresh=true`,
      {
        body: JSON.stringify({ query: { terms: { entity_id: ids } } }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }
    );
    const body = await response.text();
    expect(response.ok, body).toBe(true);
    expect(
      (JSON.parse(body) as { version_conflicts: number }).version_conflicts,
      body
    ).toBe(0);
  }).toPass({ timeout: 30_000 });
};

/**
 * Search the storefront for `query` and expect the series titled `title`
 * among the series results, or absent from them.
 *
 * A write drops the cache tags the search is held under, but revalidation
 * marks the entry stale rather than removing it, so the load right after one
 * can still show the old answer. Loading again is what reads the new one.
 */
const expectSeriesResult = async (
  page: Page,
  query: string,
  title: string,
  found: boolean
): Promise<void> => {
  await expect(async () => {
    const response = await page.goto(
      hostPath(`/search?q=${encodeURIComponent(query)}`)
    );
    expect(response?.status()).toBe(200);

    const series = page.getByRole("region", { exact: true, name: "Series" });
    await expect(series).toBeVisible({ timeout: 5000 });
    const link = series.getByRole("link", { name: title });
    await (found
      ? expect(link.first()).toBeVisible({ timeout: 2000 })
      : expect(link).toHaveCount(0, { timeout: 2000 }));
  }).toPass({ timeout: 30_000 });
};

/**
 * The storefront's catalog search, on whichever backend the server runs with.
 * The publish and unpublish case holds on both. The cases only an engine can
 * answer — a reading typed in kana, a word with a wrong character — are
 * registered under `task e2e:search` alone: the SQL backend matches the query
 * as a substring of the title as written, so they have nothing to assert there.
 */
test.describe("catalog search", () => {
  let createdSeriesIds: string[] = [];

  test.afterEach(async () => {
    await deleteSeriesDocuments(createdSeriesIds);
    deleteSeriesByPublicIds(createdSeriesIds);
    createdSeriesIds = [];
  });

  const createPublishedSeries = async (
    page: Page,
    title: string
  ): Promise<string> => {
    await signInAsSeedAdmin(page);
    const publicId = await createSeriesViaUi(page, {
      publishedAt: publishedAtOneHourAgo(),
      synopsis: `Search synopsis ${uniqueSuffix()}`,
      title,
    });
    createdSeriesIds.push(publicId);
    return publicId;
  };

  test("finds a series once it is published and no longer once it is unpublished", async ({
    page,
  }) => {
    const title = `E2E Search Harbor ${uniqueSuffix()}`;
    const publicId = await createPublishedSeries(page, title);

    await waitUntilSearchAnswers(title, publicId, true);
    await expectSeriesResult(page, title, title, true);

    // An empty publication date is what takes a series down. The date field
    // is a controlled input, so emptying it before the form hydrates leaves
    // the date in React's state and saves the series still published; the
    // hidden instant the Action reads is derived from that state, so its
    // being empty is what says the edit took.
    await page.goto(`${WEB_ADMIN_BASE_URL}/series/${publicId}`);
    const fields = seriesFormFields(page);
    await expect(fields.title).toHaveValue(title);
    const publishedAtInstant = page
      .locator("form")
      .filter({ has: fields.publishedAt })
      .locator('input[name="published_at"]');
    await expect(async () => {
      await fields.publishedAt.fill("");
      await expect(publishedAtInstant).toHaveValue("", { timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await page.getByRole("button", { name: "Update series" }).click();
    await expect(page.getByText("Series updated.")).toBeVisible({
      timeout: 30_000,
    });

    await waitUntilSearchAnswers(title, publicId, false);
    await expectSeriesResult(page, title, title, false);
  });

  if (!onOpenSearch) {
    return;
  }

  test("finds a title written in kanji from its reading typed in kana", async ({
    page,
  }) => {
    // Japanese on purpose: matching a kana query to a kanji title through the
    // dictionary's reading is the behaviour under test. No reading is entered
    // in the console, so the analyzer is the only thing that knows it.
    const title = "吾輩は猫である";
    const publicId = await createPublishedSeries(page, title);

    await waitUntilSearchAnswers("わがはいはねこ", publicId, true);
    await expectSeriesResult(page, "わがはいはねこ", title, true);
  });

  test("finds a seeded series from a query with one wrong character", async ({
    page,
  }) => {
    // Seeded straight into Postgres, so the index holds it only because
    // `task e2e:db` rebuilt the index from the database.
    const { title } = SEED_TENANT.series;
    await expectSeriesResult(page, title.replace("Seed", "Sead"), title, true);
  });
});
