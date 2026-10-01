import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { SEED_TENANT } from "../src/scenarios/multi-tenant";
import {
  hostPath,
  localeHostPath,
  tenantHost,
  WEB_HOST_BASE_URL,
} from "../src/urls";

/** The development seed tenant's stored domain, which it publishes under. */
const SEED_ORIGIN = `http://${tenantHost("localhost")}`;

const JSON_LD = 'script[type="application/ld+json"]';

type JsonLdDocument = Record<string, unknown> & {
  "@context": string;
  "@type": string;
};

/**
 * Every JSON-LD block on the page, parsed. `JSON.parse` throwing is the
 * failure a search engine would report as an unparsable block, so a page with
 * one fails here rather than further down.
 */
const readJsonLd = async (
  page: Page,
  count: number
): Promise<JsonLdDocument[]> => {
  // The documents render with the read they describe, which streams in after
  // the static shell.
  await expect(page.locator(JSON_LD)).toHaveCount(count);
  const texts = await page.locator(JSON_LD).allTextContents();
  return texts.map((text) => JSON.parse(text) as JsonLdDocument);
};

const documentOfType = (
  documents: readonly JsonLdDocument[],
  type: string
): JsonLdDocument => {
  const found = documents.find((document) => document["@type"] === type);
  expect(found, `a ${type} document`).toBeDefined();
  return found as JsonLdDocument;
};

const canonicalOf = (page: Page): Promise<string | null> =>
  page.locator('link[rel="canonical"]').getAttribute("href");

/**
 * The page's own document names the page by its canonical URL, and every
 * document is schema.org's.
 */
const expectDescribesPage = async (
  page: Page,
  documents: readonly JsonLdDocument[],
  type: string
): Promise<JsonLdDocument> => {
  for (const document of documents) {
    expect(document["@context"]).toBe("https://schema.org");
  }
  const document = documentOfType(documents, type);
  expect(document.url).toBe(await canonicalOf(page));
  return document;
};

/**
 * The trail runs on the tenant's origin and ends at the page it is on, by the
 * page's canonical URL.
 */
const expectBreadcrumbEndsAtPage = async (
  page: Page,
  documents: readonly JsonLdDocument[]
): Promise<void> => {
  const breadcrumb = documentOfType(documents, "BreadcrumbList");
  const items = breadcrumb.itemListElement as { item: string }[];
  for (const { item } of items) {
    expect(new URL(item).origin).toBe(SEED_ORIGIN);
  }
  expect(items.at(-1)?.item).toBe(await canonicalOf(page));
};

/** A series page in one locale: the work, by the page's own canonical URL. */
const expectSeriesPage = async (page: Page, path: string): Promise<void> => {
  await page.goto(path);

  const documents = await readJsonLd(page, 2);
  const series = await expectDescribesPage(page, documents, "ComicSeries");
  expect(series.name).toBe(SEED_TENANT.series.title);
  expect(series["@id"]).toBe(`${await canonicalOf(page)}#series`);
  for (const image of (series.image as string[] | undefined) ?? []) {
    expect(new URL(image).origin).toBe(SEED_ORIGIN);
  }
  await expectBreadcrumbEndsAtPage(page, documents);
};

/**
 * What a search engine reads about each indexable page: one schema.org
 * document per page at the page's canonical URL on the tenant's stored
 * domain, and a breadcrumb trail down to it.
 */
test.describe("web-host structured data", () => {
  test("the top page describes the site and the tenant behind it", async ({
    page,
  }) => {
    await page.goto(hostPath("/"));

    const documents = await readJsonLd(page, 2);
    const website = await expectDescribesPage(page, documents, "WebSite");
    expect(website.url).toBe(SEED_ORIGIN);
    expect(website.inLanguage).toBe("en");
    expect(website.name).toBe(SEED_TENANT.name);

    const organization = documentOfType(documents, "Organization");
    expect(organization["@id"]).toBe(`${SEED_ORIGIN}#organization`);
    expect(organization.name).toBe(SEED_TENANT.name);
  });

  test("a series page describes the work at its canonical URL in every locale", async ({
    page,
  }) => {
    const seriesPath = `/series/${SEED_TENANT.series.publicId}`;

    await expectSeriesPage(page, hostPath(seriesPath));
    await expectSeriesPage(page, localeHostPath("ja", seriesPath));
  });

  test("an episode page tells a free episode from a paid one", async ({
    page,
  }) => {
    const { freeEpisodeId, paidEpisodeId, publicId } = SEED_TENANT.series;

    await page.goto(hostPath(`/series/${publicId}/episodes/${freeEpisodeId}`));
    let documents = await readJsonLd(page, 2);
    const free = await expectDescribesPage(page, documents, "ComicIssue");
    expect(free.isAccessibleForFree).toBe(true);
    expect(free.isPartOf).toMatchObject({
      "@id": `${SEED_ORIGIN}/series/${publicId}#series`,
    });
    await expectBreadcrumbEndsAtPage(page, documents);

    await page.goto(hostPath(`/series/${publicId}/episodes/${paidEpisodeId}`));
    documents = await readJsonLd(page, 2);
    const paid = await expectDescribesPage(page, documents, "ComicIssue");
    expect(paid.isAccessibleForFree).toBe(false);
  });

  test("a creator page describes the person the works credit", async ({
    page,
  }) => {
    await page.goto(hostPath(`/creators/${SEED_TENANT.creatorId}`));

    const documents = await readJsonLd(page, 2);
    const profile = await expectDescribesPage(page, documents, "ProfilePage");
    expect(profile.mainEntity).toMatchObject({
      "@id": `${SEED_ORIGIN}/creators/${SEED_TENANT.creatorId}#person`,
      "@type": "Person",
      name: SEED_TENANT.creatorName,
    });
    await expectBreadcrumbEndsAtPage(page, documents);
  });

  test("a label page carries a breadcrumb trail", async ({ page }) => {
    await page.goto(hostPath(`/labels/${SEED_TENANT.labelId}`));

    const documents = await readJsonLd(page, 1);
    await expectBreadcrumbEndsAtPage(page, documents);
  });

  test("a rated series is described to a visitor who has not confirmed their age", async ({
    request,
  }) => {
    const seriesPath = hostPath(`/series/${SEED_TENANT.r18Series.publicId}`);
    const response = await request.get(`${WEB_HOST_BASE_URL}${seriesPath}`);

    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"ComicSeries"');
  });
});
