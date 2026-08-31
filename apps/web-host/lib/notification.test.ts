import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCountUnreadNotificationsApi,
  mockListNotificationsApi,
  mockMarkAllNotificationsAsReadApi,
  mockMarkNotificationAsReadApi,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockCountUnreadNotificationsApi: vi.fn(),
  mockListNotificationsApi: vi.fn(),
  mockMarkAllNotificationsAsReadApi: vi.fn(),
  mockMarkNotificationAsReadApi: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    notification: {
      countUnreadNotifications: mockCountUnreadNotificationsApi,
      listNotifications: mockListNotificationsApi,
      markAllNotificationsAsRead: mockMarkAllNotificationsAsReadApi,
      markNotificationAsRead: mockMarkNotificationAsReadApi,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
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
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("Pass the cursor token and limit as is and return the response token", async () => {
    mockListNotificationsApi.mockResolvedValue({
      nextToken: "next-page",
      notifications: [],
      previousToken: "previous-page",
    });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", {
      limit: 20,
      locale: "ja",
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

  it("Get the first page with an empty token and default limit", async () => {
    mockListNotificationsApi.mockResolvedValue({ notifications: [] });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", { locale: "ja" });

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

  it("Assemble display text and links from type and payload", async () => {
    mockListNotificationsApi.mockResolvedValue({
      notifications: [notification("n1", "2026-04-04T00:00:00Z")],
    });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", { locale: "ja" });

    expect(result.ok).toBe(true);
    expect(result.notifications).toEqual([
      {
        createdAt: "2026-04-04T00:00:00Z",
        description: "「第1話」（作品A）が公開されました。",
        href: "/series/SR01/episodes/EP01",
        id: "n1",
        isRead: false,
        notificationType: "episode_published",
        title: "新しいエピソードが公開されました",
      },
    ]);
  });

  it("Leave unknown types as generic", async () => {
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
    const result = await listNotifications("TENANT001", { locale: "ja" });

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

  it("Return server keyset order without sorting", async () => {
    mockListNotificationsApi.mockResolvedValue({
      notifications: [
        notification("n2", "2026-04-01T00:00:00Z"),
        notification("n1", "2026-06-01T00:00:00Z"),
      ],
    });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", { locale: "ja" });

    expect(result.notifications.map((item) => item.id)).toEqual(["n2", "n1"]);
  });

  it("Return permission errors in an easy-to-understand manner", async () => {
    mockListNotificationsApi.mockRejectedValue(
      new ConnectError("permission denied", Code.PermissionDenied)
    );

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", { locale: "ja" });

    expect(result).toEqual({
      message: "この操作を行う権限がありません。",
      nextToken: "",
      notifications: [],
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    });
  });

  it("If unauthenticated, it will be returned as requiring re-login.", async () => {
    mockListNotificationsApi.mockRejectedValue(
      new ConnectError("unauthenticated", Code.Unauthenticated)
    );

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", { locale: "ja" });

    expect(result).toMatchObject({
      ok: false,
      requiresSignIn: true,
    });
  });

  it("InvalidArgument of broken cursor does not cause re-login", async () => {
    mockListNotificationsApi.mockRejectedValue(
      new ConnectError("invalid cursor", Code.InvalidArgument)
    );

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", {
      locale: "ja",
      token: "djF8Znxh",
    });

    expect(result).toEqual({
      message: "入力内容に誤りがあります。",
      nextToken: "",
      notifications: [],
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    });
  });

  it("Errors that cannot be classified are not thrown from the cache function, but re-thrown by the caller.", async () => {
    mockListNotificationsApi.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    const { listNotifications } = await import("./notification");

    await expect(
      listNotifications("TENANT001", { locale: "ja" })
    ).rejects.toThrow();
  });

  it("If there is no session, return result without token", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", {
      locale: "ja",
      token: "current-page",
    });

    expect(mockListNotificationsApi).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      nextToken: "",
      notifications: [],
      ok: false,
      previousToken: "",
      requiresSignIn: true,
    });
  });

  it("Return number of unread items", async () => {
    mockCountUnreadNotificationsApi.mockResolvedValue({ unreadCount: 3 });

    const { countUnreadNotifications } = await import("./notification");
    const result = await countUnreadNotifications("TENANT001", "ja");

    expect(mockCountUnreadNotificationsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ ok: true, unreadCount: 3 });
  });

  it("If the number of unread items fails to be retrieved, an empty bell is returned.", async () => {
    mockCountUnreadNotificationsApi.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { countUnreadNotifications } = await import("./notification");
    const result = await countUnreadNotifications("TENANT001", "ja");

    expect(result).toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
      unreadCount: 0,
    });
  });

  it("The caller also resends unclassified errors for the number of unread items.", async () => {
    mockCountUnreadNotificationsApi.mockRejectedValue(new Error("boom"));

    const { countUnreadNotifications } = await import("./notification");

    await expect(countUnreadNotifications("TENANT001", "ja")).rejects.toThrow();
  });

  it("Pass notification_id to single read item", async () => {
    mockMarkNotificationAsReadApi.mockResolvedValue({ marked: true });

    const { markNotificationAsRead } = await import("./notification");
    const result = await markNotificationAsRead({
      locale: "ja",
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

  it("Returns the number of all read items", async () => {
    mockMarkAllNotificationsAsReadApi.mockResolvedValue({ markedCount: 4 });

    const { markAllNotificationsAsRead } = await import("./notification");
    const result = await markAllNotificationsAsRead("TENANT001", "ja");

    expect(result).toEqual({ markedCount: 4, ok: true });
  });

  it("A message is returned for a single read permission error.", async () => {
    mockMarkNotificationAsReadApi.mockRejectedValue(
      new ConnectError("permission denied", Code.PermissionDenied)
    );

    const { markNotificationAsRead } = await import("./notification");
    const result = await markNotificationAsRead({
      locale: "ja",
      notificationId: "11111111-1111-4111-8111-111111111111",
      tenantId: "TENANT001",
    });

    expect(result).toEqual({
      message: "この操作を行う権限がありません。",
      ok: false,
    });
  });

  it("Single read uncategorized errors will be sent again.", async () => {
    mockMarkNotificationAsReadApi.mockRejectedValue(new Error("boom"));

    const { markNotificationAsRead } = await import("./notification");

    await expect(
      markNotificationAsRead({
        locale: "ja",
        notificationId: "11111111-1111-4111-8111-111111111111",
        tenantId: "TENANT001",
      })
    ).rejects.toThrow();
  });

  it("If there is no session, do not call the single read API", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    const { markNotificationAsRead } = await import("./notification");
    const result = await markNotificationAsRead({
      locale: "ja",
      notificationId: "11111111-1111-4111-8111-111111111111",
      tenantId: "TENANT001",
    });

    expect(mockMarkNotificationAsReadApi).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    });
  });

  it("A message is returned for permission errors when all items have been read.", async () => {
    mockMarkAllNotificationsAsReadApi.mockRejectedValue(
      new ConnectError("permission denied", Code.PermissionDenied)
    );

    const { markAllNotificationsAsRead } = await import("./notification");
    const result = await markAllNotificationsAsRead("TENANT001", "ja");

    expect(result).toEqual({
      message: "この操作を行う権限がありません。",
      ok: false,
    });
  });

  it("Resend all uncategorized errors that have already been read.", async () => {
    mockMarkAllNotificationsAsReadApi.mockRejectedValue(new Error("boom"));

    const { markAllNotificationsAsRead } = await import("./notification");

    await expect(
      markAllNotificationsAsRead("TENANT001", "ja")
    ).rejects.toThrow();
  });

  it("If there is no session, do not call the all read API", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    const { markAllNotificationsAsRead } = await import("./notification");
    const result = await markAllNotificationsAsRead("TENANT001", "ja");

    expect(mockMarkAllNotificationsAsReadApi).not.toHaveBeenCalled();
    expect(result).toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    });
  });
});
