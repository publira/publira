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

  it("passes the cursor token and the limit through and returns the tokens of the response", async () => {
    mockListNotificationsApi.mockResolvedValue({
      nextToken: "next-page",
      notifications: [],
      previousToken: "previous-page",
    });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", "ja", {
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

  it("fetches the first page with an empty token and the default limit", async () => {
    mockListNotificationsApi.mockResolvedValue({ notifications: [] });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", "ja", {});

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

  it("builds the wording and the link to show from the type and the payload", async () => {
    mockListNotificationsApi.mockResolvedValue({
      notifications: [notification("n1", "2026-04-04T00:00:00Z")],
    });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", "ja", {});

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

  it("keeps an unknown type as generic", async () => {
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
    const result = await listNotifications("TENANT001", "ja", {});

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

  it("returns the keyset order of the server without re-sorting it", async () => {
    mockListNotificationsApi.mockResolvedValue({
      notifications: [
        notification("n2", "2026-04-01T00:00:00Z"),
        notification("n1", "2026-06-01T00:00:00Z"),
      ],
    });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", "ja", {});

    expect(result.notifications.map((item) => item.id)).toEqual(["n2", "n1"]);
  });

  it("returns a legible message for a permission error", async () => {
    mockListNotificationsApi.mockRejectedValue(
      new ConnectError("tenant admin role required", Code.PermissionDenied)
    );

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", "ja", {});

    expect(result).toEqual({
      message: "この操作を行う権限がありません。",
      nextToken: "",
      notifications: [],
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    });
  });

  it("does not throw an unclassifiable error out of the cached function and rethrows it at the caller", async () => {
    mockListNotificationsApi.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    const { listNotifications } = await import("./notification");

    await expect(listNotifications("TENANT001", "ja", {})).rejects.toThrow();
  });

  it("returns a result with no token when there is no session", async () => {
    mockGetSessionId.mockResolvedValue("");

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001", "ja", {
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

  it("returns the unread count", async () => {
    mockCountUnreadNotificationsApi.mockResolvedValue({ unreadCount: 3 });

    const { countUnreadNotifications } = await import("./notification");
    const result = await countUnreadNotifications("TENANT001", "ja");

    expect(mockCountUnreadNotificationsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ ok: true, unreadCount: 3 });
  });

  it("returns an empty bell when the unread count cannot be fetched", async () => {
    mockCountUnreadNotificationsApi.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { countUnreadNotifications } = await import("./notification");
    const result = await countUnreadNotifications("TENANT001", "ja");

    expect(result).toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
      requiresSignIn: false,
      unreadCount: 0,
    });
  });

  it("rethrows an unclassified error from the unread count at the caller as well", async () => {
    mockCountUnreadNotificationsApi.mockRejectedValue(new Error("boom"));

    const { countUnreadNotifications } = await import("./notification");

    await expect(countUnreadNotifications("TENANT001", "ja")).rejects.toThrow();
  });

  it("passes the notification_id when marking one notification as read", async () => {
    mockMarkNotificationAsReadApi.mockResolvedValue({ marked: true });

    const { markNotificationAsRead } = await import("./notification");
    const result = await markNotificationAsRead(
      {
        notificationId: "11111111-1111-4111-8111-111111111111",
        tenantId: "TENANT001",
      },
      "ja"
    );

    expect(mockMarkNotificationAsReadApi).toHaveBeenCalledWith(
      {
        notificationId: "11111111-1111-4111-8111-111111111111",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ ok: true });
  });

  it("returns how many notifications were marked as read", async () => {
    mockMarkAllNotificationsAsReadApi.mockResolvedValue({ markedCount: 4 });

    const { markAllNotificationsAsRead } = await import("./notification");
    const result = await markAllNotificationsAsRead("TENANT001", "ja");

    expect(result).toEqual({ markedCount: 4, ok: true });
  });
});
