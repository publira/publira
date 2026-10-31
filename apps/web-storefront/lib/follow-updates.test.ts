import { Code, ConnectError } from "@publira/api-client/errors";
import { ClientSurface } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listMyFollowUpdates } from "./follow-updates";

const { mockListMyFollowUpdates, mockResolveAccessToken } = vi.hoisted(() => ({
  mockListMyFollowUpdates: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    follow: { listMyFollowUpdates: mockListMyFollowUpdates },
  },
  buildSessionHeaders: (accessToken: string) => ({
    Authorization: `Bearer ${accessToken}`,
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCESS_TOKEN = "session-token";

const update = {
  episode: {
    orderIndex: 12,
    publicId: "EPISODE_012",
    publishedAt: "2026-09-13T22:00:00Z",
    title: "The twelfth night",
  },
  series: {
    ageRating: "SERIES_AGE_RATING_ALL",
    eyeCatchImageVariants: [],
    publicId: "SERIES_001",
    title: "A long night",
  },
};

const eyeCatch = (url: string) => [
  {
    contentType: "image/webp",
    fileSizeBytes: 4096,
    height: 160,
    label: "square 160",
    url,
    variantType: "square",
    width: 160,
  },
];

describe("listMyFollowUpdates", () => {
  beforeEach(() => {
    mockResolveAccessToken.mockResolvedValue(ACCESS_TOKEN);
    mockListMyFollowUpdates.mockResolvedValue({ updates: [update] });
  });

  it("answers the episodes that arrived in what the reader follows", async () => {
    await expect(
      listMyFollowUpdates(TENANT_ID, { locale: "en" })
    ).resolves.toEqual({
      ok: true,
      updates: [
        {
          episode: update.episode,
          eyeCatchImageVariants: undefined,
          series: {
            publicId: "SERIES_001",
            title: "A long night",
          },
        },
      ],
    });
    expect(mockListMyFollowUpdates).toHaveBeenCalledWith(
      {
        limit: 6,
        locale: "en",
        surface: ClientSurface.WEB,
        tenant: { tenantId: TENANT_ID },
        token: "",
      },
      { Authorization: "Bearer session-token" }
    );
  });

  it("draws each episode's own eye-catch, and its series' where it has none", async () => {
    const seriesCover = eyeCatch("/images/series/SERIES_001/square/160");

    const episodeCover = eyeCatch(
      "/images/episode-eye-catches/EPISODE_012/square/160"
    );

    mockListMyFollowUpdates.mockResolvedValue({
      updates: [
        {
          episode: { ...update.episode, eyeCatchImageVariants: episodeCover },
          series: { ...update.series, eyeCatchImageVariants: seriesCover },
        },
        {
          episode: {
            ...update.episode,
            eyeCatchImageVariants: [],
            publicId: "EPISODE_011",
          },
          series: { ...update.series, eyeCatchImageVariants: seriesCover },
        },
      ],
    });

    const result = await listMyFollowUpdates(TENANT_ID, { locale: "en" });

    expect(
      result.ok &&
        result.updates.map(({ episode, eyeCatchImageVariants }) => ({
          episodeId: episode.publicId,
          eyeCatchImageVariants,
        }))
    ).toEqual([
      { episodeId: "EPISODE_012", eyeCatchImageVariants: episodeCover },
      { episodeId: "EPISODE_011", eyeCatchImageVariants: seriesCover },
    ]);
  });

  it("drops a row whose episode or series lost its public ID", async () => {
    mockListMyFollowUpdates.mockResolvedValue({
      updates: [{ episode: { publicId: " " }, series: update.series }, update],
    });

    const result = await listMyFollowUpdates(TENANT_ID, { locale: "en" });

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.updates).toHaveLength(1);
  });

  it("asks a reader with no session to sign in rather than showing an empty list", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    await expect(
      listMyFollowUpdates(TENANT_ID, { locale: "en" })
    ).resolves.toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockListMyFollowUpdates).not.toHaveBeenCalled();
  });

  it("asks a reader whose session the API rejected to sign in again", async () => {
    mockListMyFollowUpdates.mockRejectedValue(
      new ConnectError("invalid session", Code.Unauthenticated)
    );

    await expect(
      listMyFollowUpdates(TENANT_ID, { locale: "en" })
    ).resolves.toMatchObject({ ok: false, requiresSignIn: true });
  });

  it("reports a refused read as a message the section can show", async () => {
    mockListMyFollowUpdates.mockRejectedValue(
      new ConnectError("nope", Code.PermissionDenied)
    );

    await expect(
      listMyFollowUpdates(TENANT_ID, { locale: "en" })
    ).resolves.toMatchObject({ ok: false, requiresSignIn: false });
  });

  it("lets a failure it cannot explain reach the boundary", async () => {
    mockListMyFollowUpdates.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      listMyFollowUpdates(TENANT_ID, { locale: "en" })
    ).rejects.toThrow("boom");
  });
});
