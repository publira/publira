import { Code, ConnectError } from "@publira/api-client/errors";
import { EpisodeAccess } from "@publira/api-client/public/catalog";
import { ClientSurface } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMySeriesPurchaseState } from "./series-purchases";

const { mockGetSeriesEpisodeAccess, mockResolveAccessToken } = vi.hoisted(
  () => ({
    mockGetSeriesEpisodeAccess: vi.fn(),
    mockResolveAccessToken: vi.fn(),
  })
);

vi.mock("./api-client", () => ({
  apiClient: {
    catalog: { getSeriesEpisodeAccess: mockGetSeriesEpisodeAccess },
  },
  buildSessionHeaders: (accessToken: string) => ({
    headers: { Authorization: `Bearer ${accessToken}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SERIES_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("getMySeriesPurchaseState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("names the episodes the reader holds and quotes the rest of the series", async () => {
    mockGetSeriesEpisodeAccess.mockResolvedValueOnce({
      episodes: [
        { access: EpisodeAccess.ENTITLED, episodeId: "EPISODE_ID_1" },
        { access: EpisodeAccess.FREE, episodeId: "EPISODE_ID_2" },
        { access: EpisodeAccess.LOCKED, episodeId: "EPISODE_ID_3" },
        { access: EpisodeAccess.ENTITLED, episodeId: "EPISODE_ID_4" },
      ],
      remainder: {
        discountPercent: 10,
        episodeCount: 1,
        listPrice: 300,
        price: 270,
      },
    });

    const result = await getMySeriesPurchaseState(TENANT_ID, SERIES_ID, "en");

    expect(mockGetSeriesEpisodeAccess).toHaveBeenCalledWith(
      {
        seriesId: SERIES_ID,
        surface: ClientSurface.WEB,
        tenant: { tenantId: TENANT_ID },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      entitledEpisodeIds: new Set(["EPISODE_ID_1", "EPISODE_ID_4"]),
      ok: true,
      remainder: {
        discountPercent: 10,
        episodeCount: 1,
        listPrice: 300,
        price: 270,
      },
    });
  });

  it("asks about a guest without a session, who is quoted the whole series", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");
    mockGetSeriesEpisodeAccess.mockResolvedValueOnce({
      episodes: [{ access: EpisodeAccess.LOCKED, episodeId: "EPISODE_ID_1" }],
      remainder: { episodeCount: 1, listPrice: 300, price: 300 },
    });

    const result = await getMySeriesPurchaseState(TENANT_ID, SERIES_ID, "en");

    expect(mockGetSeriesEpisodeAccess.mock.calls[0]?.[1]).toBeUndefined();
    expect(result).toMatchObject({
      ok: true,
      remainder: { discountPercent: 0, episodeCount: 1, price: 300 },
    });
  });

  it("offers nothing when the API quotes no sale", async () => {
    mockGetSeriesEpisodeAccess.mockResolvedValueOnce({ episodes: [] });

    await expect(
      getMySeriesPurchaseState(TENANT_ID, SERIES_ID, "en")
    ).resolves.toMatchObject({ ok: true, remainder: null });
  });

  it("offers nothing on a series taken down since the page was read", async () => {
    mockGetSeriesEpisodeAccess.mockRejectedValueOnce(
      new ConnectError("series not found", Code.NotFound)
    );

    await expect(
      getMySeriesPurchaseState(TENANT_ID, SERIES_ID, "en")
    ).resolves.toEqual({
      entitledEpisodeIds: new Set(),
      ok: true,
      remainder: null,
    });
  });

  it("reports a read that failed in the reader's language", async () => {
    mockGetSeriesEpisodeAccess.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable)
    );

    const result = await getMySeriesPurchaseState(TENANT_ID, SERIES_ID, "en");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toEqual(expect.any(String));
  });

  it("lets a failure nothing classifies reach the error boundary", async () => {
    mockGetSeriesEpisodeAccess.mockRejectedValueOnce(
      new ConnectError("bug", Code.Internal)
    );

    await expect(
      getMySeriesPurchaseState(TENANT_ID, SERIES_ID, "en")
    ).rejects.toThrow("bug");
  });
});
