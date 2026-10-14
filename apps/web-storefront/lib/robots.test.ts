import { Code, ConnectError } from "@publira/api-client/errors";
import { getLocales } from "@publira/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildRobotsTxt,
  getPublishedPageSlugs,
  respondWithRobotsTxt,
} from "./robots";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetTenantPublicOrigin,
  mockGetTenantSiteInfo,
  mockListPublishedPageSlugs,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetTenantPublicOrigin: vi.fn(),
  mockGetTenantSiteInfo: vi.fn(),
  mockListPublishedPageSlugs: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    pages: { listPublishedPageSlugs: mockListPublishedPageSlugs },
  },
}));

vi.mock("./tenant", () => ({
  getTenantPublicOrigin: mockGetTenantPublicOrigin,
  getTenantSiteInfo: mockGetTenantSiteInfo,
}));

const TENANT_ID = "019d008d-184d-7d31-a78a-89728a746e38";

const lines = (text: string): string[] => text.split("\n");

describe("buildRobotsTxt", () => {
  it("opens the catalogue and names the sitemap at the tenant's origin", () => {
    const text = buildRobotsTxt("https://shop.example.com", getLocales(), []);

    expect(lines(text).slice(0, 3)).toStrictEqual([
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
    ]);
    expect(lines(text)).toContain(
      "Sitemap: https://shop.example.com/sitemap.xml"
    );
  });

  it("disallows each reader-only path bare and under a locale prefix", () => {
    const text = lines(
      buildRobotsTxt("https://shop.example.com", getLocales(), [])
    );

    for (const path of ["/my", "/settings", "/login", "/verify"]) {
      expect(text).toContain(`Disallow: ${path}$`);
      expect(text).toContain(`Disallow: ${path}/`);
      expect(text).toContain(`Disallow: ${path}?`);
      expect(text).toContain(`Disallow: /ja${path}$`);
    }
  });

  it("allows a published page the proxy serves in place of a reader-only path", () => {
    const text = lines(
      buildRobotsTxt("https://shop.example.com", getLocales(), [
        "/my",
        "/notifications/help",
        "/privacy",
      ])
    );

    expect(text).toContain("Allow: /my$");
    expect(text).toContain("Allow: /my?");
    expect(text).toContain("Allow: /ja/my$");
    expect(text).toContain("Allow: /notifications/help$");
    expect(text).toContain("Disallow: /my/");
    expect(text).not.toContain("Allow: /my/");
    expect(text).not.toContain("Allow: /privacy$");
  });

  it("names only the locale prefixes the tenant offers", () => {
    const text = lines(
      buildRobotsTxt("https://shop.example.com", ["ja", "en"], ["/my"])
    );

    expect(text).toContain("Disallow: /ja/settings$");
    expect(text).toContain("Disallow: /en/settings$");
    expect(text).toContain("Allow: /en/my$");
    expect(text.filter((line) => line.includes("/ko/"))).toStrictEqual([]);
    expect(text.filter((line) => line.includes("/zh-"))).toStrictEqual([]);
  });

  it("does not shut out a published page whose slug starts like a reader-only path", () => {
    const text = lines(
      buildRobotsTxt("https://shop.example.com", getLocales(), [])
    );

    expect(text).not.toContain("Disallow: /my");
    expect(text).not.toContain("Disallow: /announcements$");
  });
});

describe("getPublishedPageSlugs", () => {
  beforeEach(() => {
    mockCacheLife.mockReset();
    mockCacheTag.mockReset();
    mockListPublishedPageSlugs.mockReset();
  });

  it("reads the tenant's published slugs under the pages tag", async () => {
    mockListPublishedPageSlugs.mockResolvedValueOnce({ slugs: ["/privacy"] });

    await expect(
      getPublishedPageSlugs(` ${TENANT_ID} `)
    ).resolves.toStrictEqual({ ok: true, value: ["/privacy"] });
    expect(mockCacheTag).toHaveBeenCalledWith(`tenant:${TENANT_ID}:pages`);
    expect(mockListPublishedPageSlugs).toHaveBeenCalledWith({
      tenant: { tenantId: TENANT_ID },
    });
  });

  it("reports an unavailable API as a failure and keeps it out of the cache", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      /* expected outage log from getPublishedPageSlugs */
    });
    mockListPublishedPageSlugs.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable)
    );

    await expect(getPublishedPageSlugs(TENANT_ID)).resolves.toMatchObject({
      ok: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });
});

describe("respondWithRobotsTxt", () => {
  beforeEach(() => {
    mockGetTenantPublicOrigin.mockReset();
    mockGetTenantSiteInfo.mockReset();
    mockListPublishedPageSlugs.mockReset();
    mockGetTenantSiteInfo.mockResolvedValue({ supportedLocales: ["ja", "en"] });
    mockListPublishedPageSlugs.mockResolvedValue({ slugs: [] });
  });

  it("answers the tenant's robots.txt as plain text", async () => {
    mockGetTenantPublicOrigin.mockResolvedValueOnce("https://shop.example.com");

    const response = await respondWithRobotsTxt({ tenant_id: TENANT_ID });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8"
    );
    const text = await response.text();
    expect(text).toContain("Sitemap: https://shop.example.com/sitemap.xml");
    expect(text).toContain("Disallow: /en/settings$");
    expect(text).not.toContain("/ko/");
    expect(mockGetTenantPublicOrigin).toHaveBeenCalledWith(TENANT_ID);
  });

  it("answers 503 while the tenant's pages cannot be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {
      /* expected outage log from getPublishedPageSlugs */
    });
    mockGetTenantPublicOrigin.mockResolvedValueOnce("https://shop.example.com");
    mockListPublishedPageSlugs.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable)
    );

    const response = await respondWithRobotsTxt({ tenant_id: TENANT_ID });

    expect(response.status).toBe(503);
  });

  it("answers 503 while the tenant's address is unavailable", async () => {
    mockGetTenantSiteInfo.mockResolvedValueOnce(null);
    mockGetTenantPublicOrigin.mockResolvedValueOnce(null);

    const response = await respondWithRobotsTxt({ tenant_id: TENANT_ID });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("answers 404 for a segment proxy.ts would never rewrite onto", async () => {
    const response = await respondWithRobotsTxt({ tenant_id: "favicon.ico" });

    expect(response.status).toBe(404);
    expect(mockGetTenantPublicOrigin).not.toHaveBeenCalled();
  });
});
