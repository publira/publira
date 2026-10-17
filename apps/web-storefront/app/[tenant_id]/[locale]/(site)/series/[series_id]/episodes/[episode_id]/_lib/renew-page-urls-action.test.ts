import { beforeEach, describe, expect, it, vi } from "vitest";

import { renewEpisodePageUrlsAction } from "./renew-page-urls-action";

const { mockRenewEpisodeImageUrls, mockResolveAccessToken } = vi.hoisted(
  () => ({
    mockRenewEpisodeImageUrls: vi.fn(),
    mockResolveAccessToken: vi.fn(),
  })
);

vi.mock("#lib/api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("#lib/catalog", () => ({
  renewEpisodeImageUrls: mockRenewEpisodeImageUrls,
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("renewEpisodePageUrlsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the body's URLs again for the reader's session", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("session-token");
    mockRenewEpisodeImageUrls.mockResolvedValueOnce({
      img_1: "/images/episodes/img_1?t=fresh",
    });

    await expect(
      renewEpisodePageUrlsAction(tenantId, "en", "SERIES_001", "EP_010")
    ).resolves.toEqual({ img_1: "/images/episodes/img_1?t=fresh" });
    expect(mockRenewEpisodeImageUrls).toHaveBeenCalledWith({
      accessToken: "session-token",
      episodePublicId: "EP_010",
      locale: "en",
      seriesPublicId: "SERIES_001",
      tenantId,
    });
  });

  it("answers no URL for a tenant ID that is not one", async () => {
    await expect(
      renewEpisodePageUrlsAction("TENANT_001", "en", "SERIES_001", "EP_010")
    ).resolves.toEqual({});
    expect(mockRenewEpisodeImageUrls).not.toHaveBeenCalled();
  });

  it("answers no URL for a locale the site does not serve", async () => {
    await expect(
      renewEpisodePageUrlsAction(tenantId, "xx", "SERIES_001", "EP_010")
    ).resolves.toEqual({});
    expect(mockRenewEpisodeImageUrls).not.toHaveBeenCalled();
  });
});
