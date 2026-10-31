import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  findPublishedTagBySlug: vi.fn(),
  getEpisodeDetail: vi.fn(),
  getPublishedCreatorDetail: vi.fn(),
  getPublishedLabelDetail: vi.fn(),
  getPublishedPage: vi.fn(),
  getSeriesDetail: vi.fn(),
  getTenantDefaultLocale: vi.fn(),
  getTenantPublicOrigin: vi.fn(),
  getTenantSiteCopy: vi.fn(),
  getTenantSiteInfo: vi.fn(),
  listPublishedGenres: vi.fn(),
}));

vi.mock("./catalog", () => ({
  findPublishedTagBySlug: reads.findPublishedTagBySlug,
  getEpisodeDetail: reads.getEpisodeDetail,
  getSeriesDetail: reads.getSeriesDetail,
  listPublishedGenres: reads.listPublishedGenres,
}));

vi.mock("./creators", () => ({
  CREATOR_SERIES_PAGE_SIZE: 20,
  getPublishedCreatorDetail: reads.getPublishedCreatorDetail,
}));

vi.mock("./labels", () => ({
  LABEL_SERIES_PAGE_SIZE: 20,
  getPublishedLabelDetail: reads.getPublishedLabelDetail,
}));

vi.mock("./pages", () => ({ getPublishedPage: reads.getPublishedPage }));

vi.mock("./tenant", () => ({
  getTenantDefaultLocale: reads.getTenantDefaultLocale,
  getTenantPublicOrigin: reads.getTenantPublicOrigin,
  getTenantSiteCopy: reads.getTenantSiteCopy,
  getTenantSiteInfo: reads.getTenantSiteInfo,
}));

const { openGraphCardPath, resolveOpenGraphCardText, tenantOpenGraphCardPath } =
  await import("./open-graph-card-subject");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const FAILURE = { message: "Could not show the series", ok: false } as const;

beforeEach(() => {
  reads.getTenantDefaultLocale.mockResolvedValue("en");
  reads.getTenantPublicOrigin.mockResolvedValue("https://seed.example");
  reads.getTenantSiteCopy.mockResolvedValue({});
  reads.getTenantSiteInfo.mockResolvedValue({ name: "Seed Tenant" });
});

describe("openGraphCardPath", () => {
  it.each([
    [{ kind: "site" }, "/og"],
    [{ kind: "series", seriesId: "SeedSERSAAA1" }, "/og/series/SeedSERSAAA1"],
    [
      { episodeId: "SeedEPSDAAA1", kind: "episode", seriesId: "SeedSERSAAA1" },
      "/og/series/SeedSERSAAA1/episodes/SeedEPSDAAA1",
    ],
    [{ kind: "label", labelId: "SeedLABLAAA1" }, "/og/labels/SeedLABLAAA1"],
    [
      { creatorId: "SeedAUTHAAA1", kind: "creator" },
      "/og/creators/SeedAUTHAAA1",
    ],
    [{ genreId: "SeedGNRAAAA1", kind: "genre" }, "/og/genres/SeedGNRAAAA1"],
    [{ kind: "tag", tagSlug: "fantasy" }, "/og/tags/fantasy"],
    [{ kind: "page", slug: ["legal", "terms"] }, "/og/page/legal/terms"],
  ] as const)("serves %o at %s", (subject, path) => {
    expect(openGraphCardPath(subject)).toBe(path);
  });
});

describe("tenantOpenGraphCardPath", () => {
  it("keeps the unprefixed path on the tenant's default locale", async () => {
    await expect(
      tenantOpenGraphCardPath(TENANT_ID, "en", {
        kind: "series",
        seriesId: "SeedSERSAAA1",
      })
    ).resolves.toBe("/og/series/SeedSERSAAA1");
  });

  it("prefixes the path with any other locale", async () => {
    await expect(
      tenantOpenGraphCardPath(TENANT_ID, "ja", { kind: "site" })
    ).resolves.toBe("/ja/og");
  });

  it("names no path where there is no origin to resolve it against", async () => {
    reads.getTenantPublicOrigin.mockResolvedValue(null);

    await expect(
      tenantOpenGraphCardPath(TENANT_ID, "ja", { kind: "site" })
    ).resolves.toBeUndefined();
  });
});

describe("resolveOpenGraphCardText", () => {
  it("titles a series card with the series' title", async () => {
    reads.getSeriesDetail.mockResolvedValue({
      ok: true,
      value: { series: { title: "Seed Series 001" } },
    });

    await expect(
      resolveOpenGraphCardText(TENANT_ID, "en", {
        kind: "series",
        seriesId: "SeedSERSAAA1",
      })
    ).resolves.toEqual({ ok: true, value: { title: "Seed Series 001" } });
    expect(reads.getSeriesDetail).toHaveBeenCalledWith(
      TENANT_ID,
      "SeedSERSAAA1",
      "en"
    );
  });

  it("titles an episode card the way the page does, under its series", async () => {
    reads.getEpisodeDetail.mockResolvedValue({
      ok: true,
      value: {
        episode: { orderIndex: 2, title: "Seed Episode 001-02" },
        series: { title: "Seed Series 001" },
      },
    });

    await expect(
      resolveOpenGraphCardText(TENANT_ID, "en", {
        episodeId: "SeedEPSDAAA2",
        kind: "episode",
        seriesId: "SeedSERSAAA1",
      })
    ).resolves.toEqual({
      ok: true,
      value: {
        eyebrow: "Seed Series 001",
        title: "Episode 2 Seed Episode 001-02",
      },
    });
  });

  it("reads a label on the page's own first page, so both share one entry", async () => {
    reads.getPublishedLabelDetail.mockResolvedValue({
      ok: true,
      value: { name: "Seed Label 01" },
    });

    await expect(
      resolveOpenGraphCardText(TENANT_ID, "en", {
        kind: "label",
        labelId: "SeedLABLAAA1",
      })
    ).resolves.toEqual({
      ok: true,
      value: { eyebrow: "Labels", title: "Seed Label 01" },
    });
    expect(reads.getPublishedLabelDetail).toHaveBeenCalledWith(
      TENANT_ID,
      "SeedLABLAAA1",
      { limit: 20, locale: "en", token: "" }
    );
  });

  it("reads a creator on the page's own first page, so both share one entry", async () => {
    reads.getPublishedCreatorDetail.mockResolvedValue({
      ok: true,
      value: { name: "Seed Author 001" },
    });

    await expect(
      resolveOpenGraphCardText(TENANT_ID, "en", {
        creatorId: "SeedAUTHAAA1",
        kind: "creator",
      })
    ).resolves.toEqual({
      ok: true,
      value: { eyebrow: "Authors", title: "Seed Author 001" },
    });
    expect(reads.getPublishedCreatorDetail).toHaveBeenCalledWith(
      TENANT_ID,
      "SeedAUTHAAA1",
      { limit: 20, locale: "en", token: "" }
    );
  });

  it("finds a genre in the tenant's genre list", async () => {
    reads.listPublishedGenres.mockResolvedValue({
      ok: true,
      value: [
        { name: "Drama", publicId: "SeedGNRAAAA1" },
        { name: "Fantasy", publicId: "SeedGNRAAAA2" },
      ],
    });

    await expect(
      resolveOpenGraphCardText(TENANT_ID, "en", {
        genreId: "SeedGNRAAAA2",
        kind: "genre",
      })
    ).resolves.toEqual({
      ok: true,
      value: { eyebrow: "Genres", title: "Fantasy" },
    });
  });

  it("titles a tag card and a page card with their names", async () => {
    reads.findPublishedTagBySlug.mockResolvedValue({
      ok: true,
      value: { name: "Fantasy" },
    });
    reads.getPublishedPage.mockResolvedValue({
      ok: true,
      value: { title: "Terms of Service" },
    });

    await expect(
      resolveOpenGraphCardText(TENANT_ID, "en", {
        kind: "tag",
        tagSlug: "fantasy",
      })
    ).resolves.toEqual({ ok: true, value: { title: "Fantasy" } });
    await expect(
      resolveOpenGraphCardText(TENANT_ID, "en", {
        kind: "page",
        slug: ["legal", "terms"],
      })
    ).resolves.toEqual({ ok: true, value: { title: "Terms of Service" } });
    expect(reads.getPublishedPage).toHaveBeenCalledWith(
      TENANT_ID,
      ["legal", "terms"],
      "en"
    );
  });

  it("titles the site's card with its tagline where the tenant wrote one", async () => {
    reads.getTenantSiteCopy.mockResolvedValue({
      siteTagline: "Stories worth the wait",
    });

    await expect(
      resolveOpenGraphCardText(TENANT_ID, "en", { kind: "site" })
    ).resolves.toEqual({
      ok: true,
      value: { title: "Stories worth the wait" },
    });
  });

  it("titles the site's card with its name otherwise", async () => {
    await expect(
      resolveOpenGraphCardText(TENANT_ID, "en", { kind: "site" })
    ).resolves.toEqual({ ok: true, value: { title: "Seed Tenant" } });
  });

  it("draws no site card for a tenant that could not be read", async () => {
    reads.getTenantSiteInfo.mockResolvedValue(null);

    await expect(
      resolveOpenGraphCardText(TENANT_ID, "en", { kind: "site" })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("draws no card for a subject its page would answer 404 for", async () => {
    reads.getSeriesDetail.mockResolvedValue({ ok: true, value: null });
    reads.listPublishedGenres.mockResolvedValue({ ok: true, value: [] });

    await expect(
      resolveOpenGraphCardText(TENANT_ID, "en", {
        kind: "series",
        seriesId: "ZZZZZZZZZZZZ",
      })
    ).resolves.toEqual({ ok: true, value: null });
    await expect(
      resolveOpenGraphCardText(TENANT_ID, "en", {
        genreId: "ZZZZZZZZZZZZ",
        kind: "genre",
      })
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("passes a read's failure on rather than drawing a card", async () => {
    reads.getSeriesDetail.mockResolvedValue(FAILURE);

    await expect(
      resolveOpenGraphCardText(TENANT_ID, "en", {
        kind: "series",
        seriesId: "SeedSERSAAA1",
      })
    ).resolves.toEqual(FAILURE);
  });
});
