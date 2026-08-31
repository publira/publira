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

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
}));

const notification = (id: string, createdAt: string) => ({
  createdAt,
  id,
  isRead: false,
  notificationType: "episode_publish_failed",
  payload: JSON.stringify({
    episode_id: "EP01",
    episode_title: "第1話",
    series_id: "SR01",
    series_title: "作品A",
    tenant_id: "SeedTNNTAAA1",
    tenant_name: "Acme",
  }),
  readAt: "",
});

describe("notification lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("passes cursor token and limit unchanged and returns response tokens", async () => {
    mockListNotificationsApi.mockResolvedValue({
      nextToken: "next-page",
      notifications: [],
      previousToken: "previous-page",
    });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications({
      limit: 20,
      token: "current-page",
    });

    expect(mockListNotificationsApi).toHaveBeenCalledWith(
      {
        limit: 20,
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

  it("fetches the first page with an empty token and default limit", async () => {
    mockListNotificationsApi.mockResolvedValue({ notifications: [] });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications();

    expect(mockListNotificationsApi).toHaveBeenCalledWith(
      {
        limit: 20,
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

  it("builds display copy and links from type and payload", async () => {
    mockListNotificationsApi.mockResolvedValue({
      notifications: [notification("n1", "2026-04-04T00:00:00Z")],
    });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications();

    expect(result.ok).toBe(true);
    expect(result.notifications).toEqual([
      {
        createdAt: "2026-04-04T00:00:00Z",
        description:
          "テナント「Acme」の「第1話」（作品A）を公開できませんでした。",
        href: "/tenants/SeedTNNTAAA1",
        id: "n1",
        isRead: false,
        notificationType: "episode_publish_failed",
        title: "エピソードの公開に失敗しました",
      },
    ]);
  });

  it("keeps unknown types as generic notifications", async () => {
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
    const result = await listNotifications();

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

  it("returns the server keyset order unchanged", async () => {
    mockListNotificationsApi.mockResolvedValue({
      notifications: [
        notification("n2", "2026-04-01T00:00:00Z"),
        notification("n1", "2026-06-01T00:00:00Z"),
      ],
    });

    const { listNotifications } = await import("./notification");
    const result = await listNotifications();

    expect(result.notifications.map((item) => item.id)).toEqual(["n2", "n1"]);
  });

  it("returns a clear message for permission errors", async () => {
    mockListNotificationsApi.mockRejectedValue(
      new ConnectError("platform operator role required", Code.PermissionDenied)
    );

    const { listNotifications } = await import("./notification");
    const result = await listNotifications();

    expect(result).toEqual({
      message: "この操作を行う権限がありません。",
      nextToken: "",
      notifications: [],
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    });
  });

  it("does not throw unclassified errors from the cached function and rethrows them in the caller", async () => {
    mockListNotificationsApi.mockRejectedValue(
      new ConnectError("boom", Code.Internal)
    );

    const { listNotifications } = await import("./notification");

    await expect(listNotifications()).rejects.toThrow();
  });

  it("returns a result without tokens when there is no session", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    const { listNotifications } = await import("./notification");
    const result = await listNotifications({
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
    const result = await countUnreadNotifications();

    expect(mockCountUnreadNotificationsApi).toHaveBeenCalledWith(
      {},
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ ok: true, unreadCount: 3 });
  });

  it("returns an empty bell when loading the unread count fails", async () => {
    mockCountUnreadNotificationsApi.mockRejectedValue(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { countUnreadNotifications } = await import("./notification");
    const result = await countUnreadNotifications();

    expect(result).toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
      requiresSignIn: false,
      unreadCount: 0,
    });
  });

  it("rethrows unclassified unread-count errors in the caller", async () => {
    mockCountUnreadNotificationsApi.mockRejectedValue(new Error("boom"));

    const { countUnreadNotifications } = await import("./notification");

    await expect(countUnreadNotifications()).rejects.toThrow();
  });

  it("passes notification_id when marking one notification as read", async () => {
    mockMarkNotificationAsReadApi.mockResolvedValue({ marked: true });

    const { markNotificationAsRead } = await import("./notification");
    const result = await markNotificationAsRead({
      notificationId: "11111111-1111-4111-8111-111111111111",
    });

    expect(mockMarkNotificationAsReadApi).toHaveBeenCalledWith(
      { notificationId: "11111111-1111-4111-8111-111111111111" },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ ok: true });
  });

  it("returns the count of notifications marked as read", async () => {
    mockMarkAllNotificationsAsReadApi.mockResolvedValue({ markedCount: 4 });

    const { markAllNotificationsAsRead } = await import("./notification");
    const result = await markAllNotificationsAsRead();

    expect(result).toEqual({ markedCount: 4, ok: true });
  });
});
