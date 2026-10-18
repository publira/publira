import { Code, ConnectError } from "@publira/api-client/errors";
import { ClientSurface } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { listMyEpisodeReads } from "./reading-history";

const { mockListMyEpisodeReads, mockResolveAccessToken } = vi.hoisted(() => ({
  mockListMyEpisodeReads: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    episodeRead: { listMyEpisodeReads: mockListMyEpisodeReads },
  },
  buildSessionHeaders: (accessToken: string) => ({
    Authorization: `Bearer ${accessToken}`,
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCESS_TOKEN = "session-token";

const read = {
  episode: {
    orderIndex: 2,
    publicId: "EPISODE_002",
    title: "The second night",
  },
  readAt: "2026-09-08T01:02:03Z",
  series: { publicId: "SERIES_001", title: "A long night" },
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

describe("listMyEpisodeReads", () => {
  beforeEach(() => {
    mockResolveAccessToken.mockResolvedValue(ACCESS_TOKEN);
    mockListMyEpisodeReads.mockResolvedValue({
      nextToken: "next",
      previousToken: "",
      reads: [read],
    });
  });

  it("answers the episodes the reader has finished", async () => {
    await expect(
      listMyEpisodeReads(TENANT_ID, { locale: "en" })
    ).resolves.toEqual({
      nextToken: "next",
      ok: true,
      previousToken: "",
      reads: [{ ...read, eyeCatchImageVariants: undefined }],
    });
    expect(mockListMyEpisodeReads).toHaveBeenCalledWith(
      {
        limit: 20,
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
      "/images/episode-eye-catches/EPISODE_002/square/160"
    );
    mockListMyEpisodeReads.mockResolvedValue({
      nextToken: "",
      previousToken: "",
      reads: [
        {
          ...read,
          episode: { ...read.episode, eyeCatchImageVariants: episodeCover },
          series: { ...read.series, eyeCatchImageVariants: seriesCover },
        },
        {
          ...read,
          episode: {
            ...read.episode,
            eyeCatchImageVariants: [],
            publicId: "EPISODE_001",
          },
          series: { ...read.series, eyeCatchImageVariants: seriesCover },
        },
      ],
    });

    const result = await listMyEpisodeReads(TENANT_ID, { locale: "en" });

    expect(
      result.reads.map(({ episode, eyeCatchImageVariants }) => ({
        episodeId: episode.publicId,
        eyeCatchImageVariants,
      }))
    ).toEqual([
      { episodeId: "EPISODE_002", eyeCatchImageVariants: episodeCover },
      { episodeId: "EPISODE_001", eyeCatchImageVariants: seriesCover },
    ]);
  });

  it("passes the page token on", async () => {
    await listMyEpisodeReads(TENANT_ID, { limit: 5, locale: "en", token: "t" });

    expect(mockListMyEpisodeReads).toHaveBeenCalledWith(
      {
        limit: 5,
        locale: "en",
        surface: ClientSurface.WEB,
        tenant: { tenantId: TENANT_ID },
        token: "t",
      },
      { Authorization: "Bearer session-token" }
    );
  });

  it("asks a reader with no session to sign in rather than showing an empty history", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    await expect(
      listMyEpisodeReads(TENANT_ID, { locale: "en" })
    ).resolves.toMatchObject({ ok: false, reads: [], requiresSignIn: true });
    expect(mockListMyEpisodeReads).not.toHaveBeenCalled();
  });

  it("asks a reader whose session the API rejected to sign in again", async () => {
    mockListMyEpisodeReads.mockRejectedValue(
      new ConnectError("invalid session", Code.Unauthenticated)
    );

    await expect(
      listMyEpisodeReads(TENANT_ID, { locale: "en" })
    ).resolves.toMatchObject({ ok: false, requiresSignIn: true });
  });

  it("reports a refused read as a message the section can show", async () => {
    mockListMyEpisodeReads.mockRejectedValue(
      new ConnectError("nope", Code.PermissionDenied)
    );

    await expect(
      listMyEpisodeReads(TENANT_ID, { locale: "en" })
    ).resolves.toMatchObject({ ok: false, requiresSignIn: false });
  });

  it("lets a failure it cannot explain reach the boundary", async () => {
    mockListMyEpisodeReads.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    await expect(
      listMyEpisodeReads(TENANT_ID, { locale: "en" })
    ).rejects.toThrow("boom");
  });
});
