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
  getSessionId: mockGetSessionId,
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
    headers: { "X-Publira-Session-Id": sessionId },
  }),
}));

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
}));

describe("notification lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
    mockListTenantUsersApi.mockResolvedValue({ users: [] });
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

  it("権限エラーを分かりやすく返す", async () => {
    mockListNotificationsApi.mockRejectedValue(
      new Error("permission_denied: tenant admin role required")
    );

    const { listNotifications } = await import("./notification");
    const result = await listNotifications("TENANT001");

    expect(result).toEqual({
      message: "この操作を行う権限がありません。",
      notifications: [],
      ok: false,
      users: [],
      usersErrorMessage: undefined,
    });
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
      tenantPublicId: "TENANT001",
      title: "タイトル",
    });

    expect(result).toEqual({ createdCount: 2, ok: true });
  });
});
