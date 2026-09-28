import { Code, ConnectError } from "@publira/api-client/errors";
import { SitemapEntryKind } from "@publira/api-client/public/catalog";
import { getLocales } from "@publira/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSitemapChunk,
  getSitemapFileTokens,
  renderSitemapIndex,
  renderSitemapUrlset,
  respondWithSitemap,
  respondWithSitemapFile,
  SITEMAP_BYTE_LIMIT,
  SITEMAP_URL_LIMIT,
  toSitemapEntryItem,
} from "./sitemap";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetTenantPublicOrigin,
  mockGetTenantSiteInfo,
  mockListSitemapEntries,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetTenantPublicOrigin: vi.fn(),
  mockGetTenantSiteInfo: vi.fn(),
  mockListSitemapEntries: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    catalog: { listSitemapEntries: mockListSitemapEntries },
  },
}));

vi.mock("./tenant", () => ({
  getTenantPublicOrigin: mockGetTenantPublicOrigin,
  getTenantSiteInfo: mockGetTenantSiteInfo,
}));

const TENANT_ID = "019d008d-184d-7d31-a78a-89728a746e38";
const ORIGIN = "https://shop.example.com";
const ADDRESS = { defaultLocale: "en", origin: ORIGIN } as const;
const LOCALE_COUNT = getLocales().length;

const entry = (overrides: {
  kind: SitemapEntryKind;
  lastModifiedAt?: string;
  publicId?: string;
  seriesPublicId?: string;
  slug?: string;
}) => ({
  lastModifiedAt: "",
  publicId: "",
  seriesPublicId: "",
  slug: "",
  ...overrides,
});

const seriesEntry = (publicId: string) =>
  entry({ kind: SitemapEntryKind.SERIES, publicId });

/**
 * A catalogue of `pageCount` API pages of `limit` entries each, addressed by a
 * token naming the page it points at.
 */
const answerPages = (
  pageCount: number,
  entryAt: (page: number, index: number) => ReturnType<typeof entry> = (
    page,
    index
  ) => seriesEntry(`S${page}-${index}`)
) => {
  mockListSitemapEntries.mockImplementation(
    ({ limit, token }: { limit: number; token: string }) => {
      const page = token ? Number(token.slice(1)) : 0;
      return {
        entries: Array.from({ length: limit }, (_, index) =>
          entryAt(page, index)
        ),
        nextToken: page + 1 < pageCount ? `p${page + 1}` : "",
      };
    }
  );
};

const countOf = (xml: string, needle: string): number =>
  xml.split(needle).length - 1;

const utf8Bytes = (value: string): number =>
  new TextEncoder().encode(value).byteLength;

beforeEach(() => {
  mockCacheLife.mockReset();
  mockCacheTag.mockReset();
  mockGetTenantPublicOrigin.mockReset();
  mockGetTenantSiteInfo.mockReset();
  mockListSitemapEntries.mockReset();
  mockGetTenantPublicOrigin.mockResolvedValue(ORIGIN);
  mockGetTenantSiteInfo.mockResolvedValue({ defaultLocale: "en" });
});

describe("toSitemapEntryItem", () => {
  it("names each kind at the path the storefront serves it on", () => {
    expect(
      [
        seriesEntry("SERIES000001"),
        entry({
          kind: SitemapEntryKind.EPISODE,
          publicId: "EPISODE00001",
          seriesPublicId: "SERIES000001",
        }),
        entry({ kind: SitemapEntryKind.LABEL, publicId: "LABEL0000001" }),
        entry({ kind: SitemapEntryKind.CREATOR, publicId: "CREATOR00001" }),
        entry({ kind: SitemapEntryKind.GENRE, publicId: "GENRE0000001" }),
        entry({ kind: SitemapEntryKind.PAGE, slug: "/legal/terms" }),
      ].flatMap(toSitemapEntryItem)
    ).toStrictEqual([
      { href: "/series/SERIES000001" },
      { href: "/series/SERIES000001/episodes/EPISODE00001" },
      { href: "/labels/LABEL0000001" },
      { href: "/creators/CREATOR00001" },
      { href: "/genres/GENRE0000001" },
      { href: "/legal/terms" },
    ]);
  });

  it("carries the time an entry last changed where the API names one", () => {
    expect(
      toSitemapEntryItem(
        entry({
          kind: SitemapEntryKind.SERIES,
          lastModifiedAt: "2026-09-28T01:02:03Z",
          publicId: "SERIES000001",
        })
      )
    ).toStrictEqual([
      { href: "/series/SERIES000001", lastModifiedAt: "2026-09-28T01:02:03Z" },
    ]);
  });

  it("drops an entry its URL cannot be made for", () => {
    expect(
      [
        entry({ kind: SitemapEntryKind.EPISODE, publicId: "EPISODE00001" }),
        entry({ kind: SitemapEntryKind.LABEL }),
        entry({ kind: SitemapEntryKind.PAGE, slug: "/" }),
        entry({
          kind: SitemapEntryKind.UNSPECIFIED,
          publicId: "SERIES000001",
        }),
      ].flatMap(toSitemapEntryItem)
    ).toStrictEqual([]);
  });
});

describe("renderSitemapUrlset", () => {
  it("lists a page once in each locale, each naming every locale as an alternate", () => {
    const xml = renderSitemapUrlset(ADDRESS, [
      { href: "/series/SERIES000001", lastModifiedAt: "2026-09-28T01:02:03Z" },
    ]);

    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
    );
    expect(countOf(xml, "<url>")).toBe(LOCALE_COUNT);
    expect(xml).toContain(`<url><loc>${ORIGIN}/series/SERIES000001</loc>`);
    expect(xml).toContain(`<url><loc>${ORIGIN}/ja/series/SERIES000001</loc>`);
    expect(
      countOf(
        xml,
        `<xhtml:link rel="alternate" hreflang="ja" href="${ORIGIN}/ja/series/SERIES000001"/>`
      )
    ).toBe(LOCALE_COUNT);
    expect(
      countOf(
        xml,
        `<xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}/series/SERIES000001"/><lastmod>2026-09-28T01:02:03Z</lastmod></url>`
      )
    ).toBe(LOCALE_COUNT);
  });

  it("names the root in each locale", () => {
    const xml = renderSitemapUrlset(ADDRESS, [{ href: "/" }]);

    expect(xml).toContain(`<url><loc>${ORIGIN}/</loc>`);
    expect(xml).toContain(`<url><loc>${ORIGIN}/ja</loc>`);
  });

  it("escapes what a page slug may hold", () => {
    const xml = renderSitemapUrlset(ADDRESS, [{ href: "/q&a" }]);

    expect(xml).toContain(`<loc>${ORIGIN}/q&amp;a</loc>`);
  });
});

describe("renderSitemapIndex", () => {
  it("names each file at the tenant's origin", () => {
    expect(renderSitemapIndex(ORIGIN, 2)).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        `<sitemap><loc>${ORIGIN}/sitemap/0.xml</loc></sitemap>`,
        `<sitemap><loc>${ORIGIN}/sitemap/1.xml</loc></sitemap>`,
        "</sitemapindex>",
        "",
      ].join("\n")
    );
  });
});

describe("getSitemapChunk", () => {
  it("walks the list from its token under the tags that publication drops", async () => {
    mockListSitemapEntries
      .mockResolvedValueOnce({
        entries: [seriesEntry("SERIES000001")],
        nextToken: "next",
      })
      .mockResolvedValueOnce({
        entries: [seriesEntry("SERIES000002")],
        nextToken: "",
      });

    await expect(
      getSitemapChunk(` ${TENANT_ID} `, ADDRESS, "start")
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        entries: [
          { href: "/series/SERIES000001" },
          { href: "/series/SERIES000002" },
        ],
        nextToken: "",
      },
    });
    expect(mockListSitemapEntries.mock.calls).toStrictEqual([
      [{ limit: 500, tenant: { tenantId: TENANT_ID }, token: "start" }],
      [{ limit: 500, tenant: { tenantId: TENANT_ID }, token: "next" }],
    ]);
    expect(mockCacheTag.mock.calls.map(([tag]) => tag)).toStrictEqual([
      `tenant:${TENANT_ID}:series:list`,
      `tenant:${TENANT_ID}:series:detail`,
      `tenant:${TENANT_ID}:labels`,
      `tenant:${TENANT_ID}:creators`,
      `tenant:${TENANT_ID}:pages`,
    ]);
  });

  it("opens the first file with the catalogue's index pages", async () => {
    mockListSitemapEntries.mockResolvedValueOnce({
      entries: [seriesEntry("SERIES000001")],
      nextToken: "",
    });

    const chunk = await getSitemapChunk(TENANT_ID, ADDRESS, "");

    expect(
      chunk.ok && chunk.value.entries.map(({ href }) => href)
    ).toStrictEqual([
      "/",
      "/series",
      "/ranking",
      "/labels",
      "/creators",
      "/genres",
      "/series/SERIES000001",
    ]);
  });

  it("ends a file before it would pass the URL limit", async () => {
    answerPages(40);

    const chunk = await getSitemapChunk(TENANT_ID, ADDRESS, "p1");

    expect(chunk.ok).toBe(true);
    const entries = chunk.ok ? chunk.value.entries : [];
    expect(entries.length * LOCALE_COUNT).toBeLessThanOrEqual(
      SITEMAP_URL_LIMIT
    );
    expect(entries.length * LOCALE_COUNT).toBeGreaterThan(
      SITEMAP_URL_LIMIT - 500 * LOCALE_COUNT
    );
    expect(chunk.ok && chunk.value.nextToken).not.toBe("");
  });

  it("ends a file before it would pass the byte limit", async () => {
    // Pages at slugs as long as the column holds, the most bytes an entry takes.
    answerPages(40, (page, index) =>
      entry({
        kind: SitemapEntryKind.PAGE,
        slug: "/".concat(`${page}-${index}-`.padEnd(254, "p")),
      })
    );

    const chunk = await getSitemapChunk(TENANT_ID, ADDRESS, "p1");
    const entries = chunk.ok ? chunk.value.entries : [];
    const bytes = utf8Bytes(renderSitemapUrlset(ADDRESS, entries));

    expect(bytes).toBeLessThanOrEqual(SITEMAP_BYTE_LIMIT);
    expect(entries.length * LOCALE_COUNT).toBeLessThan(
      SITEMAP_URL_LIMIT - 500 * LOCALE_COUNT
    );
    expect(chunk.ok && chunk.value.nextToken).not.toBe("");
  });

  it("reports an unavailable API as a failure and keeps it out of the cache", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      /* expected outage log from getSitemapChunk */
    });
    mockListSitemapEntries.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable)
    );

    await expect(
      getSitemapChunk(TENANT_ID, ADDRESS, "")
    ).resolves.toMatchObject({ ok: false });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("getSitemapFileTokens", () => {
  it("names where each file starts under the tags its files carry", async () => {
    answerPages(40);

    await expect(
      getSitemapFileTokens(` ${TENANT_ID} `, ADDRESS)
    ).resolves.toStrictEqual({ ok: true, value: ["", "p19", "p39"] });
    expect(mockCacheTag).toHaveBeenCalledWith(
      `tenant:${TENANT_ID}:series:detail`
    );
  });

  it("reports an unavailable API as a failure and keeps it out of the cache", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      /* expected outage log from getSitemapChunk */
    });
    mockListSitemapEntries.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable)
    );

    await expect(
      getSitemapFileTokens(TENANT_ID, ADDRESS)
    ).resolves.toMatchObject({ ok: false });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("respondWithSitemap", () => {
  it("answers the whole sitemap as one file while it fits", async () => {
    mockListSitemapEntries.mockResolvedValue({
      entries: [seriesEntry("SERIES000001")],
      nextToken: "",
    });

    const response = await respondWithSitemap({ tenant_id: TENANT_ID });
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "application/xml; charset=utf-8"
    );
    expect(xml).toContain("<urlset");
    expect(xml).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/series</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/series/SERIES000001</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/ja/series/SERIES000001</loc>`);
  });

  it("answers an index of files once the sitemap outgrows one", async () => {
    answerPages(40);

    const response = await respondWithSitemap({ tenant_id: TENANT_ID });
    const xml = await response.text();

    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain(`<loc>${ORIGIN}/sitemap/0.xml</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/sitemap/2.xml</loc>`);
    expect(xml).not.toContain(`${ORIGIN}/sitemap/3.xml`);
  });

  it("answers 503 while the API cannot be asked", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      /* expected outage log from getSitemapChunk */
    });
    mockListSitemapEntries.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable)
    );

    const response = await respondWithSitemap({ tenant_id: TENANT_ID });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("answers 503 while the tenant's address is unavailable", async () => {
    mockGetTenantPublicOrigin.mockResolvedValue(null);

    const response = await respondWithSitemap({ tenant_id: TENANT_ID });

    expect(response.status).toBe(503);
    expect(mockListSitemapEntries).not.toHaveBeenCalled();
  });
});

describe("respondWithSitemapFile", () => {
  it("answers one file of an indexed sitemap, with the index pages in the first alone", async () => {
    answerPages(40);

    const firstResponse = await respondWithSitemapFile({
      sitemap_id: "0.xml",
      tenant_id: TENANT_ID,
    });
    const lastResponse = await respondWithSitemapFile({
      sitemap_id: "2.xml",
      tenant_id: TENANT_ID,
    });
    const first = await firstResponse.text();
    const last = await lastResponse.text();

    expect(first).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(first).toContain(`<loc>${ORIGIN}/series/S0-0</loc>`);
    expect(last).not.toContain(`<loc>${ORIGIN}/</loc>`);
    expect(last).toContain(`<loc>${ORIGIN}/series/S39-0</loc>`);
    expect(countOf(last, "<url>")).toBe(500 * LOCALE_COUNT);
  });

  it("reads a file from where it starts rather than through the files before it", async () => {
    answerPages(40);
    await getSitemapFileTokens(TENANT_ID, ADDRESS);
    mockListSitemapEntries.mockClear();

    await respondWithSitemapFile({ sitemap_id: "2.xml", tenant_id: TENANT_ID });

    // Uncached in a unit test, the token walk reads every page again; the file
    // itself then reads only its own page.
    expect(mockListSitemapEntries.mock.calls.at(-1)).toStrictEqual([
      { limit: 500, tenant: { tenantId: TENANT_ID }, token: "p39" },
    ]);
  });

  it.each(["3.xml", "one.xml", "1"])(
    "answers 404 for the file %s the sitemap does not have",
    async (sitemapId) => {
      answerPages(40);

      const response = await respondWithSitemapFile({
        sitemap_id: sitemapId,
        tenant_id: TENANT_ID,
      });

      expect(response.status).toBe(404);
    }
  );
});
