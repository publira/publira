import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSessionId,
  mockListAnnouncementsApi,
  mockCreateAnnouncementsApi,
  mockListTenantUsersApi,
} = vi.hoisted(() => ({
  mockCreateAnnouncementsApi: vi.fn(),
  mockGetSessionId: vi.fn(),
  mockListAnnouncementsApi: vi.fn(),
  mockListTenantUsersApi: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetSessionId,
}));

vi.mock("./api", () => ({
  apiClient: {
    announcement: {
      createAnnouncement: mockCreateAnnouncementsApi,
      listAnnouncements: mockListAnnouncementsApi,
    },
    users: {
      listTenantUsers: mockListTenantUsersApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
}));

const announcement = (id: string, createdAt: string) => ({
  audienceType: 1,
  body: "本文",
  createdAt,
  id,
  linkUrl: "",
  targetUserName: "",
  targetUserPublicId: "",
  title: "タイトル",
});

describe("announcement lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
    mockListTenantUsersApi.mockResolvedValue({ users: [] });
  });

  it("passes the cursor token and the limit through and returns the tokens of the response", async () => {
    mockListAnnouncementsApi.mockResolvedValue({
      announcements: [],
      nextToken: "next-page",
      previousToken: "previous-page",
    });

    const { listAnnouncements } = await import("./announcement");
    const result = await listAnnouncements("TENANT001", {
      limit: 20,
      token: "current-page",
    });

    expect(mockListAnnouncementsApi).toHaveBeenCalledWith(
      {
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "current-page",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({
      nextToken: "next-page",
      ok: true,
      previousToken: "previous-page",
    });
  });

  it("fetches the first page with an empty token and the default limit", async () => {
    mockListAnnouncementsApi.mockResolvedValue({ announcements: [] });

    const { listAnnouncements } = await import("./announcement");
    const result = await listAnnouncements("TENANT001");

    expect(mockListAnnouncementsApi).toHaveBeenCalledWith(
      {
        limit: 20,
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    // トークン未指定の応答でも、呼び出し側が分岐せずに済むよう空文字へそろえる。
    expect(result).toMatchObject({
      nextToken: "",
      ok: true,
      previousToken: "",
    });
  });

  it("converts the announcement list", async () => {
    mockListAnnouncementsApi.mockResolvedValue({
      announcements: [
        {
          audienceType: 2,
          body: "本文",
          createdAt: "2026-04-04T00:00:00Z",
          id: "n1",
          linkUrl: "/series/S001",
          targetUserName: "User One",
          targetUserPublicId: "USER001",
          title: "タイトル",
        },
      ],
    });

    const { listAnnouncements } = await import("./announcement");
    const result = await listAnnouncements("TENANT001");

    expect(result.ok).toBe(true);
    expect(result.announcements).toEqual([
      {
        audienceType: "selected",
        body: "本文",
        createdAt: "2026-04-04T00:00:00Z",
        id: "n1",
        linkUrl: "/series/S001",
        targetUserName: "User One",
        targetUserPublicId: "USER001",
        title: "タイトル",
      },
    ]);
  });

  it("returns the keyset order of the server without re-sorting it", async () => {
    mockListAnnouncementsApi.mockResolvedValue({
      announcements: [
        announcement("n2", "2026-04-01T00:00:00Z"),
        announcement("n1", "2026-06-01T00:00:00Z"),
      ],
    });

    const { listAnnouncements } = await import("./announcement");
    const result = await listAnnouncements("TENANT001");

    expect(result.announcements.map((item) => item.id)).toEqual(["n2", "n1"]);
  });

  it("returns a legible message for a permission error", async () => {
    mockListAnnouncementsApi.mockRejectedValue(
      new ConnectError("tenant admin role required", Code.PermissionDenied)
    );

    const { listAnnouncements } = await import("./announcement");
    const result = await listAnnouncements("TENANT001");

    expect(result).toEqual({
      announcements: [],
      message: "この操作を行う権限がありません。",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    });
  });

  it("returns a result with no token when there is no session", async () => {
    mockGetSessionId.mockResolvedValue("");

    const { listAnnouncements } = await import("./announcement");
    const result = await listAnnouncements("TENANT001", {
      token: "current-page",
    });

    expect(mockListAnnouncementsApi).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      announcements: [],
      nextToken: "",
      ok: false,
      previousToken: "",
    });
  });

  it("returns a result with no token when the fetch fails", async () => {
    mockListAnnouncementsApi.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listAnnouncements } = await import("./announcement");
    const result = await listAnnouncements("TENANT001", {
      token: "current-page",
    });

    expect(result).toMatchObject({
      announcements: [],
      nextToken: "",
      ok: false,
      previousToken: "",
    });
  });

  it("does not read the target users while listing announcements", async () => {
    mockListAnnouncementsApi.mockResolvedValue({ announcements: [] });

    const { listAnnouncements } = await import("./announcement");
    await listAnnouncements("TENANT001");

    // 対象ユーザーは作成画面だけが要るので、一覧のたびに引かない。
    expect(mockListTenantUsersApi).not.toHaveBeenCalled();
  });

  it("follows the cursor to collect every page of target users", async () => {
    mockListTenantUsersApi
      .mockResolvedValueOnce({
        nextToken: "page-2",
        users: [{ name: "ヤマダ", publicId: "USER001" }],
      })
      .mockResolvedValueOnce({
        nextToken: "",
        users: [{ name: "アオキ", publicId: "USER002" }],
      });

    const { listAllAnnouncementTargetUsers } = await import("./announcement");
    const result = await listAllAnnouncementTargetUsers("TENANT001");

    expect(mockListTenantUsersApi).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        query: "",
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockListTenantUsersApi).toHaveBeenNthCalledWith(
      2,
      {
        limit: 100,
        query: "",
        tenant: { tenantId: "TENANT001" },
        token: "page-2",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    // 2 ページ目の候補まで選択肢に載り、全体を名前順に並べ替える。
    expect(result).toEqual({
      ok: true,
      users: [
        { name: "アオキ", publicId: "USER002" },
        { name: "ヤマダ", publicId: "USER001" },
      ],
    });
  });

  it("offers no choices when the target users cannot be read to the last page", async () => {
    // 同じ token が返り続ける壊れた応答。途中まで集めた候補を「全員」として
    // 見せると、載っていない相手を選べないことに気付けない。
    mockListTenantUsersApi.mockResolvedValue({
      nextToken: "same-token",
      users: [{ name: "ヤマダ", publicId: "USER001" }],
    });

    const { listAllAnnouncementTargetUsers } = await import("./announcement");
    const result = await listAllAnnouncementTargetUsers("TENANT001");

    expect(result).toEqual({
      message: "対象ユーザー一覧の取得に失敗しました。",
      ok: false,
      requiresSignIn: false,
      users: [],
    });
  });

  it("returns a message when the target users cannot be fetched", async () => {
    mockListTenantUsersApi.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listAllAnnouncementTargetUsers } = await import("./announcement");
    const result = await listAllAnnouncementTargetUsers("TENANT001");

    expect(result).toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
      requiresSignIn: false,
      users: [],
    });
  });

  it("returns the count once the announcement is created", async () => {
    mockCreateAnnouncementsApi.mockResolvedValue({
      announcements: [{ id: "n1" }, { id: "n2" }],
    });

    const { createAnnouncement } = await import("./announcement");
    const result = await createAnnouncement({
      audienceType: "all",
      body: "本文",
      linkUrl: "",
      targetUserPublicIds: [],
      tenantId: "TENANT001",
      title: "タイトル",
    });

    expect(result).toEqual({ createdCount: 2, ok: true });
  });
});
