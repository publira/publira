import { Code, ConnectError } from "@publira/api-client/errors";
import { FollowTargetType } from "@publira/api-client/public/catalog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FollowListEntry } from "./follow-list";

const {
  mockGetPublishedAuthorDetail,
  mockGetSeriesDetail,
  mockListMyFollows,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockGetPublishedAuthorDetail: vi.fn(),
  mockGetSeriesDetail: vi.fn(),
  mockListMyFollows: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    follow: {
      listMyFollows: mockListMyFollows,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("./authors", () => ({
  getPublishedAuthorDetail: mockGetPublishedAuthorDetail,
}));

vi.mock("./catalog", () => ({
  getSeriesDetail: mockGetSeriesDetail,
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const seriesFollow = {
  followedAt: "2026-06-02T00:00:00Z",
  targetPublicId: "SERIES01",
  targetType: FollowTargetType.SERIES,
};

const authorFollow = {
  followedAt: "2026-06-01T00:00:00Z",
  targetPublicId: "AUTHOR01",
  targetType: FollowTargetType.AUTHOR,
};

describe("listMyFollows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("Pass the cursor token and limit as is and return the response token", async () => {
    mockListMyFollows.mockResolvedValue({
      follows: [],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    const { listMyFollows } = await import("./follow-list");
    const result = await listMyFollows(tenantId, {
      limit: 20,
      locale: "en",
      token: "current-page",
    });

    expect(mockListMyFollows).toHaveBeenCalledWith(
      {
        limit: 20,
        tenant: { tenantId },
        token: "current-page",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      follows: [],
      nextToken: "next-page",
      ok: true,
      previousToken: "previous-page",
    });
  });

  it("Get the first page with an empty token and default limit", async () => {
    mockListMyFollows.mockResolvedValue({ follows: [] });

    const { listMyFollows } = await import("./follow-list");
    const result = await listMyFollows(tenantId, { locale: "en" });

    expect(mockListMyFollows).toHaveBeenCalledWith(
      {
        limit: 20,
        tenant: { tenantId },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({
      follows: [],
      nextToken: "",
      ok: true,
      previousToken: "",
    });
  });

  it("Return works and authors with target type in server order", async () => {
    mockListMyFollows.mockResolvedValue({
      follows: [seriesFollow, authorFollow],
      nextToken: "",
      previousToken: "",
    });

    const { listMyFollows } = await import("./follow-list");
    const result = await listMyFollows(tenantId, { locale: "en" });

    expect(result.ok).toBe(true);
    expect(result.follows).toEqual([
      {
        followedAt: "2026-06-02T00:00:00Z",
        publicId: "SERIES01",
        targetKind: "series",
      },
      {
        followedAt: "2026-06-01T00:00:00Z",
        publicId: "AUTHOR01",
        targetKind: "author",
      },
    ]);
  });

  it("Drop target types that this app does not handle", async () => {
    mockListMyFollows.mockResolvedValue({
      follows: [
        {
          followedAt: "2026-06-03T00:00:00Z",
          targetPublicId: "EPISODE01",
          targetType: FollowTargetType.EPISODE,
        },
        seriesFollow,
      ],
    });

    const { listMyFollows } = await import("./follow-list");
    const result = await listMyFollows(tenantId, { locale: "en" });

    expect(result.follows).toEqual([
      {
        followedAt: "2026-06-02T00:00:00Z",
        publicId: "SERIES01",
        targetKind: "series",
      },
    ]);
  });

  it("Guest does not call RPC and returns it as requiring re-login", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");

    const { listMyFollows } = await import("./follow-list");
    const result = await listMyFollows(tenantId, { locale: "en" });

    expect(result).toEqual({
      follows: [],
      message: "Your session is no longer valid. Please sign in again.",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
    });
    expect(mockListMyFollows).not.toHaveBeenCalled();
  });

  it("If unauthenticated, it will be returned as requiring re-login.", async () => {
    mockListMyFollows.mockRejectedValue(
      new ConnectError("unauthenticated", Code.Unauthenticated)
    );

    const { listMyFollows } = await import("./follow-list");
    const result = await listMyFollows(tenantId, { locale: "en" });

    expect(result).toMatchObject({
      ok: false,
      requiresSignIn: true,
    });
  });

  it("Return permission errors in an easy-to-understand manner", async () => {
    mockListMyFollows.mockRejectedValue(
      new ConnectError("permission denied", Code.PermissionDenied)
    );

    const { listMyFollows } = await import("./follow-list");
    const result = await listMyFollows(tenantId, { locale: "en" });

    expect(result).toEqual({
      follows: [],
      message: "You do not have permission to perform this action.",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    });
  });

  it("Throw for unexpected failures", async () => {
    mockListMyFollows.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    const { listMyFollows } = await import("./follow-list");
    await expect(listMyFollows(tenantId, { locale: "en" })).rejects.toThrow(
      "Could not load your follows. Please try again later."
    );
  });
});

describe("resolveFollowListItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  const entries: FollowListEntry[] = [
    {
      followedAt: "2026-06-02T00:00:00Z",
      publicId: "SERIES01",
      targetKind: "series",
    },
    {
      followedAt: "2026-06-01T00:00:00Z",
      publicId: "AUTHOR01",
      targetKind: "author",
    },
  ];

  it("Add the title of the published work/author and the published page URL", async () => {
    mockGetSeriesDetail.mockResolvedValueOnce({
      ok: true,
      value: { episodes: [], series: { title: "Published Series" } },
    });
    mockGetPublishedAuthorDetail.mockResolvedValueOnce({
      ok: true,
      value: { name: "Published Author" },
    });

    const { resolveFollowListItems } = await import("./follow-list");
    await expect(
      resolveFollowListItems(tenantId, entries, "en")
    ).resolves.toEqual([
      {
        followedAt: "2026-06-02T00:00:00Z",
        href: "/series/SERIES01",
        publicId: "SERIES01",
        targetKind: "series",
        title: "Published Series",
        unavailable: false,
      },
      {
        followedAt: "2026-06-01T00:00:00Z",
        href: "/authors/AUTHOR01",
        publicId: "AUTHOR01",
        targetKind: "author",
        title: "Published Author",
        unavailable: false,
      },
    ]);
    expect(mockGetPublishedAuthorDetail).toHaveBeenCalledWith(
      tenantId,
      "AUTHOR01",
      { limit: 1, locale: "en" }
    );
  });

  it("Do not link to a target that has become private, and leave it as closed.", async () => {
    mockGetSeriesDetail.mockResolvedValueOnce({ ok: true, value: null });

    const { resolveFollowListItems } = await import("./follow-list");
    const [seriesEntry] = entries;
    await expect(
      resolveFollowListItems(tenantId, [seriesEntry], "en")
    ).resolves.toEqual([
      {
        followedAt: "2026-06-02T00:00:00Z",
        href: undefined,
        publicId: "SERIES01",
        targetKind: "series",
        title: "Not currently published",
        unavailable: true,
      },
    ]);
  });

  it("If catalog acquisition fails, use publicId as title and leave link.", async () => {
    mockGetPublishedAuthorDetail.mockResolvedValueOnce({
      message: "Could not load the author.",
      ok: false,
    });

    const { resolveFollowListItems } = await import("./follow-list");
    const [, authorEntry] = entries;
    await expect(
      resolveFollowListItems(tenantId, [authorEntry], "en")
    ).resolves.toEqual([
      {
        followedAt: "2026-06-01T00:00:00Z",
        href: "/authors/AUTHOR01",
        publicId: "AUTHOR01",
        targetKind: "author",
        title: "AUTHOR01",
        unavailable: false,
      },
    ]);
  });
});
