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

  it("cursor token と limit をそのまま渡し、応答のトークンを返す", async () => {
    mockListMyFollows.mockResolvedValue({
      follows: [],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    const { listMyFollows } = await import("./follow-list");
    const result = await listMyFollows(tenantId, {
      limit: 20,
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

  it("最初のページは空のトークンと既定 limit で取得する", async () => {
    mockListMyFollows.mockResolvedValue({ follows: [] });

    const { listMyFollows } = await import("./follow-list");
    const result = await listMyFollows(tenantId);

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

  it("作品と著者を対象種別付きで、サーバーの順のまま返す", async () => {
    mockListMyFollows.mockResolvedValue({
      follows: [seriesFollow, authorFollow],
      nextToken: "",
      previousToken: "",
    });

    const { listMyFollows } = await import("./follow-list");
    const result = await listMyFollows(tenantId);

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

  it("このアプリが扱わない対象種別は落とす", async () => {
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
    const result = await listMyFollows(tenantId);

    expect(result.follows).toEqual([
      {
        followedAt: "2026-06-02T00:00:00Z",
        publicId: "SERIES01",
        targetKind: "series",
      },
    ]);
  });

  it("ゲストは RPC を呼ばず再ログインが必要として返す", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");

    const { listMyFollows } = await import("./follow-list");
    const result = await listMyFollows(tenantId);

    expect(result).toEqual({
      follows: [],
      message: "セッションが無効です。再ログインしてください。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
    });
    expect(mockListMyFollows).not.toHaveBeenCalled();
  });

  it("未認証は再ログインが必要として返す", async () => {
    mockListMyFollows.mockRejectedValue(
      new ConnectError("unauthenticated", Code.Unauthenticated)
    );

    const { listMyFollows } = await import("./follow-list");
    const result = await listMyFollows(tenantId);

    expect(result).toMatchObject({
      ok: false,
      requiresSignIn: true,
    });
  });

  it("権限エラーを分かりやすく返す", async () => {
    mockListMyFollows.mockRejectedValue(
      new ConnectError("permission denied", Code.PermissionDenied)
    );

    const { listMyFollows } = await import("./follow-list");
    const result = await listMyFollows(tenantId);

    expect(result).toEqual({
      follows: [],
      message: "この操作を行う権限がありません。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    });
  });

  it("想定外の失敗は throw する", async () => {
    mockListMyFollows.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    const { listMyFollows } = await import("./follow-list");
    await expect(listMyFollows(tenantId)).rejects.toThrow(
      "フォロー一覧を取得できませんでした。時間をおいて再試行してください。"
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

  it("公開中の作品・著者のタイトルと公開ページ URL を付ける", async () => {
    mockGetSeriesDetail.mockResolvedValueOnce({
      ok: true,
      value: { episodes: [], series: { title: "公開シリーズ" } },
    });
    mockGetPublishedAuthorDetail.mockResolvedValueOnce({
      ok: true,
      value: { name: "公開著者" },
    });

    const { resolveFollowListItems } = await import("./follow-list");
    await expect(resolveFollowListItems(tenantId, entries)).resolves.toEqual([
      {
        followedAt: "2026-06-02T00:00:00Z",
        href: "/series/SERIES01",
        publicId: "SERIES01",
        targetKind: "series",
        title: "公開シリーズ",
        unavailable: false,
      },
      {
        followedAt: "2026-06-01T00:00:00Z",
        href: "/authors/AUTHOR01",
        publicId: "AUTHOR01",
        targetKind: "author",
        title: "公開著者",
        unavailable: false,
      },
    ]);
    expect(mockGetPublishedAuthorDetail).toHaveBeenCalledWith(
      tenantId,
      "AUTHOR01",
      { limit: 1 }
    );
  });

  it("非公開になった対象はリンクせず、公開終了として残す", async () => {
    mockGetSeriesDetail.mockResolvedValueOnce({ ok: true, value: null });

    const { resolveFollowListItems } = await import("./follow-list");
    const [seriesEntry] = entries;
    await expect(
      resolveFollowListItems(tenantId, [seriesEntry])
    ).resolves.toEqual([
      {
        followedAt: "2026-06-02T00:00:00Z",
        href: undefined,
        publicId: "SERIES01",
        targetKind: "series",
        title: "現在公開されていません",
        unavailable: true,
      },
    ]);
  });

  it("カタログ取得の失敗では publicId をタイトルにしてリンクは残す", async () => {
    mockGetPublishedAuthorDetail.mockResolvedValueOnce({
      message: "著者を取得できませんでした。",
      ok: false,
    });

    const { resolveFollowListItems } = await import("./follow-list");
    const [, authorEntry] = entries;
    await expect(
      resolveFollowListItems(tenantId, [authorEntry])
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
