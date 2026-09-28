import { Code, ConnectError } from "@publira/api-client/errors";
import { SitemapEntryKind } from "@publira/api-client/public/catalog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getSitemapChunk,
  renderSitemapIndex,
  renderSitemapUrlset,
  respondWithSitemap,
  respondWithSitemapFile,
  SITEMAP_ENTRIES_PER_FILE,
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
 * A catalogue of `pageCount` API pages of `limit` series each, addressed by a
 * token naming the page it points at.
 */
const answerPages = (pageCount: number) => {
  mockListSitemapEntries.mockImplementation(
    ({ limit, token }: { limit: number; token: string }) => {
      const page = token ? Number(token.slice(1)) : 0;
      return {
        entries: Array.from({ length: limit }, (_, index) =>
          seriesEntry(`S${page}-${index}`)
        ),
        nextToken: page + 1 < pageCount ? `p${page + 1}` : "",
      };
    }
  );
};

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
  it("lists each page at its default-locale URL with the other locales beside it", () => {
    const xml = renderSitemapUrlset(ORIGIN, "en", [
      { href: "/series/SERIES000001", lastModifiedAt: "2026-09-28T01:02:03Z" },
      { href: "/" },
    ]);

    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'
    );
    expect(xml).toContain(
      `<url><loc>${ORIGIN}/series/SERIES000001</loc><xhtml:link`
    );
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="en" href="${ORIGIN}/series/SERIES000001"/>`
    );
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="ja" href="${ORIGIN}/ja/series/SERIES000001"/>`
    );
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}/series/SERIES000001"/><lastmod>2026-09-28T01:02:03Z</lastmod></url>`
    );
    expect(xml).toContain(
      `<xhtml:link rel="alternate" hreflang="ja" href="${ORIGIN}/ja"/>`
    );
  });

  it("escapes what a page slug may hold", () => {
    const xml = renderSitemapUrlset(ORIGIN, "en", [{ href: "/q&a" }]);

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
      getSitemapChunk(` ${TENANT_ID} `, "start")
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
      [{ limit: 1000, tenant: { tenantId: TENANT_ID }, token: "start" }],
      [{ limit: 1000, tenant: { tenantId: TENANT_ID }, token: "next" }],
    ]);
    expect(mockCacheTag.mock.calls.map(([tag]) => tag)).toStrictEqual([
      `tenant:${TENANT_ID}:series:list`,
      `tenant:${TENANT_ID}:series:detail`,
      `tenant:${TENANT_ID}:labels`,
      `tenant:${TENANT_ID}:creators`,
      `tenant:${TENANT_ID}:pages`,
    ]);
  });

  it("stops at a full file and hands back where the next one starts", async () => {
    answerPages(50);

    const chunk = await getSitemapChunk(TENANT_ID, "");

    expect(chunk.ok && chunk.value.entries).toHaveLength(
      SITEMAP_ENTRIES_PER_FILE
    );
    expect(chunk.ok && chunk.value.nextToken).toBe("p49");
  });

  it("reports an unavailable API as a failure and keeps it out of the cache", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      /* expected outage log from getSitemapChunk */
    });
    mockListSitemapEntries.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable)
    );

    await expect(getSitemapChunk(TENANT_ID, "")).resolves.toMatchObject({
      ok: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("respondWithSitemap", () => {
  it("answers the whole sitemap as one file while it fits", async () => {
    mockListSitemapEntries.mockResolvedValueOnce({
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
  });

  it("answers an index of files once the sitemap outgrows one", async () => {
    answerPages(50);

    const response = await respondWithSitemap({ tenant_id: TENANT_ID });
    const xml = await response.text();

    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain(`<loc>${ORIGIN}/sitemap/0.xml</loc>`);
    expect(xml).toContain(`<loc>${ORIGIN}/sitemap/1.xml</loc>`);
    expect(xml).not.toContain(`${ORIGIN}/sitemap/2.xml`);
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
    answerPages(50);

    const firstResponse = await respondWithSitemapFile({
      sitemap_id: "0.xml",
      tenant_id: TENANT_ID,
    });
    const secondResponse = await respondWithSitemapFile({
      sitemap_id: "1.xml",
      tenant_id: TENANT_ID,
    });
    const first = await firstResponse.text();
    const second = await secondResponse.text();

    expect(first).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(first).toContain(`<loc>${ORIGIN}/series/S0-0</loc>`);
    expect(second).not.toContain(`<loc>${ORIGIN}/</loc>`);
    expect(second).toContain(`<loc>${ORIGIN}/series/S49-0</loc>`);
    expect(second.match(/<url>/gu)).toHaveLength(1000);
  });

  it.each(["2.xml", "one.xml", "1"])(
    "answers 404 for the file %s the sitemap does not have",
    async (sitemapId) => {
      answerPages(50);

      const response = await respondWithSitemapFile({
        sitemap_id: sitemapId,
        tenant_id: TENANT_ID,
      });

      expect(response.status).toBe(404);
    }
  );
});
