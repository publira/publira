import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCountUnreadNotificationsApi,
  mockGetSessionId,
  mockListNotificationsApi,
  mockMarkAllNotificationsAsReadApi,
  mockMarkNotificationAsReadApi,
} = vi.hoisted(() => ({
  mockCountUnreadNotificationsApi: vi.fn(),
  mockGetSessionId: vi.fn(),
  mockListNotificationsApi: vi.fn(),
  mockMarkAllNotificationsAsReadApi: vi.fn(),
  mockMarkNotificationAsReadApi: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetSessionId,
}));

vi.mock("./api", () => ({
  apiClient: {
    notification: {
      countUnreadNotifications: mockCountUnreadNotificationsApi,
      listNotifications: mockListNotificationsApi,
      markAllNotificationsAsRead: mockMarkAllNotificationsAsReadApi,
      markNotificationAsRead: mockMarkNotificationAsReadApi,
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
  createdAt,
  id,
  isRead: false,
  notificationType: "episode_published",
  payload: JSON.stringify({
    episode_id: "EP01",
    episode_title: "第1話",
    series_id: "SR01",
    series_title: "作品A",
  }),
  readAt: "",
});

describe("notification lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
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
    expect(result).toMatchObject({
      nextToken: "",
      ok: true,
      previousToken: "",
    });
  });

  it("type と payload から表示用の文言とリンクを組み立てる", async () => {
    mockListNotificationsApi.mockResolvedValue({
      notifications: [notification("n1", "2026-04-04T00:00:00Z")],
    });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001");

    expect(result.ok).toBe(true);
    expect(result.notifications).toEqual([
      {
        createdAt: "2026-04-04T00:00:00Z",
        description: "「第1話」（作品A）を公開しました。",
        href: "/series/SR01/episodes/EP01",
        id: "n1",
        isRead: false,
        notificationType: "episode_published",
        title: "エピソードが公開されました",
      },
    ]);
  });

  it("未知 type も generic として残す", async () => {
    mockListNotificationsApi.mockResolvedValue({
      notifications: [
        {
          createdAt: "2026-04-04T00:00:00Z",
          id: "n1",
          isRead: true,
          notificationType: "smtp_dead",
          payload: "{}",
          readAt: "2026-04-04T01:00:00Z",
        },
      ],
    });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001");

    expect(result.notifications).toEqual([
      {
        createdAt: "2026-04-04T00:00:00Z",
        description: "内容の詳細はありません。",
        href: undefined,
        id: "n1",
        isRead: true,
        notificationType: "smtp_dead",
        title: "通知",
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

  it("分類できないエラーはキャッシュ関数から throw せず、呼び出し側で再送出する", async () => {
    mockListNotificationsApi.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    const { listNotifications } = await import("./notification");

    await expect(listNotifications("TENANT001")).rejects.toThrow();
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

  it("未読件数を返す", async () => {
    mockCountUnreadNotificationsApi.mockResolvedValue({ unreadCount: 3 });

    const { countUnreadNotifications } = await import("./notification");
    const result = await countUnreadNotifications("TENANT001");

    expect(mockCountUnreadNotificationsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ ok: true, unreadCount: 3 });
  });

  it("未読件数の取得失敗は空のベルとして返す", async () => {
    mockCountUnreadNotificationsApi.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { countUnreadNotifications } = await import("./notification");
    const result = await countUnreadNotifications("TENANT001");

    expect(result).toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
      unreadCount: 0,
    });
  });

  it("未読件数の未分類エラーも呼び出し側で再送出する", async () => {
    mockCountUnreadNotificationsApi.mockRejectedValue(new Error("boom"));

    const { countUnreadNotifications } = await import("./notification");

    await expect(countUnreadNotifications("TENANT001")).rejects.toThrow();
  });

  it("単件既読に notification_id を渡す", async () => {
    mockMarkNotificationAsReadApi.mockResolvedValue({ marked: true });

    const { markNotificationAsRead } = await import("./notification");
    const result = await markNotificationAsRead({
      notificationId: "11111111-1111-4111-8111-111111111111",
      tenantId: "TENANT001",
    });

    expect(mockMarkNotificationAsReadApi).toHaveBeenCalledWith(
      {
        notificationId: "11111111-1111-4111-8111-111111111111",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ ok: true });
  });

  it("全件既読の件数を返す", async () => {
    mockMarkAllNotificationsAsReadApi.mockResolvedValue({ markedCount: 4 });

    const { markAllNotificationsAsRead } = await import("./notification");
    const result = await markAllNotificationsAsRead("TENANT001");

    expect(result).toEqual({ markedCount: 4, ok: true });
  });
});
