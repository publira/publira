import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCacheTag, mockListCampaignBanners } = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockListCampaignBanners: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    catalog: { listCampaignBanners: mockListCampaignBanners },
  },
}));

vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: mockCacheTag,
}));

const importCampaignBanners = () => import("./campaign-banners");

const tenantId = "11111111-1111-4111-8111-111111111111";

const variant = {
  contentType: "image/webp",
  fileSizeBytes: 1024n,
  height: 450,
  label: "800w",
  url: "https://cdn.example.com/banners/BANNER01/landscape-800.webp",
  variantType: "landscape",
  width: 800,
};

const BANNER = {
  altText: "Autumn sale",
  imageUpdatedAt: "2026-10-01T00:00:00Z",
  imageVariants: [variant],
  linkUrl: "/series/SERIES01",
  publicId: "BANNER01",
};

const banner = (overrides: Partial<typeof BANNER> = {}) => ({
  ...BANNER,
  ...overrides,
});

describe("listCampaignBanners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers the banners showing now in the order the API sent them", async () => {
    const { listCampaignBanners } = await importCampaignBanners();
    mockListCampaignBanners.mockResolvedValueOnce({
      banners: [
        banner(),
        banner({
          altText: undefined,
          linkUrl: "https://example.com/campaign",
          publicId: "BANNER02",
        }),
      ],
    });

    await expect(listCampaignBanners(tenantId)).resolves.toEqual([
      {
        altText: "Autumn sale",
        imageVariants: [{ ...variant, fileSizeBytes: 1024 }],
        linkUrl: "/series/SERIES01",
        publicId: "BANNER01",
      },
      {
        altText: "",
        imageVariants: [{ ...variant, fileSizeBytes: 1024 }],
        linkUrl: "https://example.com/campaign",
        publicId: "BANNER02",
      },
    ]);
    expect(mockListCampaignBanners).toHaveBeenCalledWith({
      tenant: { tenantId },
    });
  });

  // The console and the ticker job drop this tag; a read under any other one
  // would keep a closed window's banner on the page.
  it("carries the tag the server drops when a banner changes or a window turns", async () => {
    const { listCampaignBanners } = await importCampaignBanners();
    mockListCampaignBanners.mockResolvedValueOnce({ banners: [] });

    await listCampaignBanners(tenantId);

    expect(mockCacheTag).toHaveBeenCalledWith(
      `tenant:${tenantId}:campaign-banners`
    );
  });

  it("answers an empty list when no banner is showing", async () => {
    const { listCampaignBanners } = await importCampaignBanners();
    mockListCampaignBanners.mockResolvedValueOnce({});

    await expect(listCampaignBanners(tenantId)).resolves.toEqual([]);
  });

  it("drops a banner whose link this site may not follow", async () => {
    const { listCampaignBanners } = await importCampaignBanners();
    mockListCampaignBanners.mockResolvedValueOnce({
      banners: [
        banner({ linkUrl: "//evil.example", publicId: "BANNER01" }),
        banner({ publicId: "BANNER02" }),
      ],
    });

    const banners = await listCampaignBanners(tenantId);

    expect(banners.map(({ publicId }) => publicId)).toEqual(["BANNER02"]);
  });

  it("drops a banner with no image left to draw", async () => {
    const { listCampaignBanners } = await importCampaignBanners();
    mockListCampaignBanners.mockResolvedValueOnce({
      banners: [
        banner({ imageVariants: [], publicId: "BANNER01" }),
        banner({
          imageVariants: [{ ...variant, url: "" }],
          publicId: "BANNER02",
        }),
        banner({ publicId: "BANNER03" }),
      ],
    });

    const banners = await listCampaignBanners(tenantId);

    expect(banners.map(({ publicId }) => publicId)).toEqual(["BANNER03"]);
  });

  it("answers an empty list when the read fails, so the band is simply not drawn", async () => {
    const { listCampaignBanners } = await importCampaignBanners();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockListCampaignBanners.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(listCampaignBanners(tenantId)).resolves.toEqual([]);
    warn.mockRestore();
  });

  it("reports an unexpected failure in the log rather than throwing", async () => {
    const { listCampaignBanners } = await importCampaignBanners();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = new ConnectError("handler panicked", Code.Internal);
    mockListCampaignBanners.mockRejectedValueOnce(failure);

    await expect(listCampaignBanners(tenantId)).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "[web-storefront] listCampaignBanners failed",
      failure
    );
    warn.mockRestore();
  });

  it("asks for nothing when there is no tenant to ask about", async () => {
    const { listCampaignBanners } = await importCampaignBanners();

    await expect(listCampaignBanners("  ")).resolves.toEqual([]);
    expect(mockListCampaignBanners).not.toHaveBeenCalled();
  });
});
