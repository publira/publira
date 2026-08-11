import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetSessionId,
  mockListNotificationsApi,
  mockCreateNotificationApi,
  mockListTenantUsersApi,
} = vi.hoisted(() => ({
  mockCreateNotificationApi: vi.fn(),
  mockGetSessionId: vi.fn(),
  mockListNotificationsApi: vi.fn(),
  mockListTenantUsersApi: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetSessionId,
}));

vi.mock("./api", () => ({
  apiClient: {
    notification: {
      createNotification: mockCreateNotificationApi,
      listNotifications: mockListNotificationsApi,
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

const notification = (id: string, createdAt: string) => ({
  audienceType: 1,
  body: "本文",
  createdAt,
  id,
  linkUrl: "",
  targetUserName: "",
  targetUserPublicId: "",
  title: "タイトル",
});

describe("notification lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
    mockListTenantUsersApi.mockResolvedValue({ users: [] });
  });

  it("cursor token と limit をそのまま渡し、応答のトークンを返す", async () => {
    mockListNotificationsApi.mockResolvedValue({
      nextToken: "next-page",
      notifications: [],
      previousToken: "previous-page",
    });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", {
      limit: 20,
      token: "current-page",
    });

    expect(mockListNotificationsApi).toHaveBeenCalledWith(
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

  it("最初のページは空のトークンと既定 limit で取得する", async () => {
    mockListNotificationsApi.mockResolvedValue({ notifications: [] });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001");

    expect(mockListNotificationsApi).toHaveBeenCalledWith(
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

  it("通知一覧を正しく変換する", async () => {
    mockListNotificationsApi.mockResolvedValue({
      notifications: [
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

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001");

    expect(result.ok).toBe(true);
    expect(result.notifications).toEqual([
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

  it("サーバーのキーセット順を並べ替えずに返す", async () => {
    mockListNotificationsApi.mockResolvedValue({
      notifications: [
        notification("n2", "2026-04-01T00:00:00Z"),
        notification("n1", "2026-06-01T00:00:00Z"),
      ],
    });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001");

    expect(result.notifications.map((item) => item.id)).toEqual(["n2", "n1"]);
  });

  it("権限エラーを分かりやすく返す", async () => {
    mockListNotificationsApi.mockRejectedValue(
      new ConnectError("tenant admin role required", Code.PermissionDenied)
    );

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001");

    expect(result).toEqual({
      message: "この操作を行う権限がありません。",
      nextToken: "",
      notifications: [],
      ok: false,
      previousToken: "",
    });
  });

  it("セッションが無ければトークンなしの結果を返す", async () => {
    mockGetSessionId.mockResolvedValue("");

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", {
      token: "current-page",
    });

    expect(mockListNotificationsApi).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      nextToken: "",
      notifications: [],
      ok: false,
      previousToken: "",
    });
  });

  it("取得に失敗してもトークンなしの結果を返す", async () => {
    mockListNotificationsApi.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", {
      token: "current-page",
    });

    expect(result).toMatchObject({
      nextToken: "",
      notifications: [],
      ok: false,
      previousToken: "",
    });
  });

  it("一覧取得では対象ユーザーを読まない", async () => {
    mockListNotificationsApi.mockResolvedValue({ notifications: [] });

    const { listNotifications } = await import("./notification");
    await listNotifications("TENANT001");

    // 対象ユーザーは作成画面だけが要るので、一覧のたびに引かない。
    expect(mockListTenantUsersApi).not.toHaveBeenCalled();
  });

  it("対象ユーザーは cursor をたどって全ページ集める", async () => {
    mockListTenantUsersApi
      .mockResolvedValueOnce({
        nextToken: "page-2",
        users: [{ name: "ヤマダ", publicId: "USER001" }],
      })
      .mockResolvedValueOnce({
        nextToken: "",
        users: [{ name: "アオキ", publicId: "USER002" }],
      });

    const { listAllNotificationTargetUsers } = await import("./notification");
    const result = await listAllNotificationTargetUsers("TENANT001");

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

  it("対象ユーザーを全ページ読めなければ選択肢を出さない", async () => {
    // 同じ token が返り続ける壊れた応答。途中まで集めた候補を「全員」として
    // 見せると、載っていない相手を選べないことに気付けない。
    mockListTenantUsersApi.mockResolvedValue({
      nextToken: "same-token",
      users: [{ name: "ヤマダ", publicId: "USER001" }],
    });

    const { listAllNotificationTargetUsers } = await import("./notification");
    const result = await listAllNotificationTargetUsers("TENANT001");

    expect(result.ok).toBe(false);
    expect(result.users).toEqual([]);
  });

  it("対象ユーザーの取得に失敗したらメッセージを返す", async () => {
    mockListTenantUsersApi.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listAllNotificationTargetUsers } = await import("./notification");
    const result = await listAllNotificationTargetUsers("TENANT001");

    expect(result.ok).toBe(false);
    expect(result.users).toEqual([]);
  });

  it("通知作成成功時に件数を返す", async () => {
    mockCreateNotificationApi.mockResolvedValue({
      notifications: [{ id: "n1" }, { id: "n2" }],
    });

    const { createNotification } = await import("./notification");
    const result = await createNotification({
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
