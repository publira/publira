import { Code, ConnectError } from "@publira/api-client/errors";
import { SeriesAgeRating } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMySeriesProgress, listMyRecentSeries } from "./reading-progress";

const {
  mockGetMySeriesProgress,
  mockListMyRecentSeries,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockGetMySeriesProgress: vi.fn(),
  mockListMyRecentSeries: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    episodeRead: {
      getMySeriesProgress: mockGetMySeriesProgress,
      listMyRecentSeries: mockListMyRecentSeries,
    },
  },
  buildSessionHeaders: (accessToken: string) => ({
    Authorization: `Bearer ${accessToken}`,
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SERIES_PUBLIC_ID = "SERIES_001";
const ACCESS_TOKEN = "session-token";

const episode = {
  orderIndex: 3,
  publicId: "EPISODE_003",
  title: "The third night",
};

const series = {
  eyeCatchImageVariants: [
    {
      contentType: "image/webp",
      fileSizeBytes: 1024,
      height: 630,
      label: "Landscape",
      url: "https://example.test/landscape.webp",
      variantType: "landscape",
      width: 1200,
    },
  ],
  publicId: SERIES_PUBLIC_ID,
  title: "A long night",
};

describe("listMyRecentSeries", () => {
  beforeEach(() => {
    mockResolveAccessToken.mockResolvedValue(ACCESS_TOKEN);
    mockListMyRecentSeries.mockResolvedValue({ series: [{ episode, series }] });
  });

  it("answers the series the reader is in the middle of", async () => {
    await expect(
      listMyRecentSeries(TENANT_ID, { limit: 6, locale: "en" })
    ).resolves.toEqual({
      ok: true,
      series: [
        {
          episode,
          series: {
            eyeCatchImageVariants: series.eyeCatchImageVariants,
            publicId: SERIES_PUBLIC_ID,
            title: "A long night",
          },
        },
      ],
    });
    expect(mockListMyRecentSeries).toHaveBeenCalledWith(
      { limit: 6, tenant: { tenantId: TENANT_ID }, token: "" },
      { Authorization: "Bearer session-token" }
    );
  });

  it("carries the age rating so the home row can hide a rated series", async () => {
    mockListMyRecentSeries.mockResolvedValue({
      series: [
        {
          episode,
          series: { ...series, ageRating: SeriesAgeRating.R18 },
        },
      ],
    });

    const result = await listMyRecentSeries(TENANT_ID, { locale: "en" });

    expect(result.ok && result.series[0]?.series.ageRating).toBe("r18");
  });

  it("drops an entry the offer cannot be built from", async () => {
    mockListMyRecentSeries.mockResolvedValue({
      series: [{ episode: { ...episode, publicId: " " }, series }],
    });

    await expect(
      listMyRecentSeries(TENANT_ID, { locale: "en" })
    ).resolves.toEqual({ ok: true, series: [] });
  });

  it("leaves a guest with nothing to continue", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    await expect(
      listMyRecentSeries(TENANT_ID, { locale: "en" })
    ).resolves.toEqual({ ok: true, series: [] });
    expect(mockListMyRecentSeries).not.toHaveBeenCalled();
  });

  it("treats a rejected session as a guest", async () => {
    mockListMyRecentSeries.mockRejectedValue(
      new ConnectError("invalid session", Code.Unauthenticated)
    );

    await expect(
      listMyRecentSeries(TENANT_ID, { locale: "en" })
    ).resolves.toEqual({ ok: true, series: [] });
  });

  it("reports a refused read as a message the row can show", async () => {
    mockListMyRecentSeries.mockRejectedValue(
      new ConnectError("token is invalid", Code.InvalidArgument)
    );

    const result = await listMyRecentSeries(TENANT_ID, { locale: "en" });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).not.toBe("");
  });

  it("lets a failure it cannot explain reach the boundary", async () => {
    mockListMyRecentSeries.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      listMyRecentSeries(TENANT_ID, { locale: "en" })
    ).rejects.toThrow("boom");
  });
});

describe("getMySeriesProgress", () => {
  beforeEach(() => {
    mockResolveAccessToken.mockResolvedValue(ACCESS_TOKEN);
    mockGetMySeriesProgress.mockResolvedValue({
      progress: { episode, isFinished: false },
    });
  });

  it("answers the episode the member last moved in", async () => {
    await expect(
      getMySeriesProgress(TENANT_ID, SERIES_PUBLIC_ID, "en")
    ).resolves.toEqual({
      finishedEpisodePublicIds: [],
      ok: true,
      progress: { episode, isFinished: false },
      signedIn: true,
    });
    expect(mockGetMySeriesProgress).toHaveBeenCalledWith(
      { seriesPublicId: SERIES_PUBLIC_ID, tenant: { tenantId: TENANT_ID } },
      { Authorization: "Bearer session-token" }
    );
  });

  it("carries the episodes of the series the member has finished", async () => {
    mockGetMySeriesProgress.mockResolvedValue({
      finishedEpisodePublicIds: ["EPISODE_001", "EPISODE_002"],
      progress: { episode, isFinished: false },
    });

    await expect(
      getMySeriesProgress(TENANT_ID, SERIES_PUBLIC_ID, "en")
    ).resolves.toMatchObject({
      finishedEpisodePublicIds: ["EPISODE_001", "EPISODE_002"],
    });
  });

  it("reports finished episodes for a member who has saved no position", async () => {
    mockGetMySeriesProgress.mockResolvedValue({
      finishedEpisodePublicIds: ["EPISODE_001"],
    });

    await expect(
      getMySeriesProgress(TENANT_ID, SERIES_PUBLIC_ID, "en")
    ).resolves.toEqual({
      finishedEpisodePublicIds: ["EPISODE_001"],
      ok: true,
      progress: null,
      signedIn: true,
    });
  });

  it("answers no progress for a member who opened none of the series", async () => {
    mockGetMySeriesProgress.mockResolvedValue({});

    await expect(
      getMySeriesProgress(TENANT_ID, SERIES_PUBLIC_ID, "en")
    ).resolves.toEqual({
      finishedEpisodePublicIds: [],
      ok: true,
      progress: null,
      signedIn: true,
    });
  });

  it("tells a guest apart from a member with no progress", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    await expect(
      getMySeriesProgress(TENANT_ID, SERIES_PUBLIC_ID, "en")
    ).resolves.toEqual({
      finishedEpisodePublicIds: [],
      ok: true,
      progress: null,
      signedIn: false,
    });
    expect(mockGetMySeriesProgress).not.toHaveBeenCalled();
  });

  it("treats a rejected session as a guest", async () => {
    mockGetMySeriesProgress.mockRejectedValue(
      new ConnectError("invalid session", Code.Unauthenticated)
    );

    await expect(
      getMySeriesProgress(TENANT_ID, SERIES_PUBLIC_ID, "en")
    ).resolves.toEqual({
      finishedEpisodePublicIds: [],
      ok: true,
      progress: null,
      signedIn: false,
    });
  });

  it("lets a failure it cannot explain reach the boundary", async () => {
    mockGetMySeriesProgress.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      getMySeriesProgress(TENANT_ID, SERIES_PUBLIC_ID, "en")
    ).rejects.toThrow("boom");
  });
});
