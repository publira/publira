import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListNotifications,
  mockMarkAllNotificationsAsRead,
  mockMarkNotificationAsRead,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockListNotifications: vi.fn(),
  mockMarkAllNotificationsAsRead: vi.fn(),
  mockMarkNotificationAsRead: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    auth: {
      listNotifications: mockListNotifications,
      markAllNotificationsAsRead: mockMarkAllNotificationsAsRead,
      markNotificationAsRead: mockMarkNotificationAsRead,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  unstable_noStore: vi.fn(),
}));

const importNotifications = () => import("./notifications");

describe("web-host notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("sid_001");
  });

  it("listMyNotifications: API 応答を画面用に変換する", async () => {
    const { listMyNotifications } = await importNotifications();

    mockListNotifications.mockResolvedValueOnce({
      nextToken: "djF8Zg",
      notifications: [
        {
          body: "本文",
          createdAt: "2026-04-05T10:00:00Z",
          id: "N001",
          isRead: false,
          linkUrl: "/series/S001",
          title: "お知らせ",
        },
      ],
      previousToken: "",
    });

    await expect(listMyNotifications("TENANT001")).resolves.toEqual({
      nextToken: "djF8Zg",
      notifications: [
        {
          body: "本文",
          createdAt: "2026-04-05T10:00:00Z",
          id: "N001",
          isRead: false,
          linkUrl: "/series/S001",
          title: "お知らせ",
        },
      ],
      ok: true,
      previousToken: "",
    });
  });

  it("listMyNotifications: token を指定なしなら先頭ページを既定件数で引く", async () => {
    const { listMyNotifications } = await importNotifications();
    mockListNotifications.mockResolvedValueOnce({ notifications: [] });

    await listMyNotifications("TENANT001");

    expect(mockListNotifications).toHaveBeenCalledWith(
      { limit: 20, tenant: { tenantId: "TENANT001" }, token: "" },
      expect.anything()
    );
  });

  it("listMyNotifications: 渡された cursor と件数をそのまま RPC に載せる", async () => {
    const { listMyNotifications } = await importNotifications();
    mockListNotifications.mockResolvedValueOnce({ notifications: [] });

    await listMyNotifications("TENANT001", "sid_001", {
      limit: 5,
      token: "djF8Zg",
    });

    expect(mockListNotifications).toHaveBeenCalledWith(
      { limit: 5, tenant: { tenantId: "TENANT001" }, token: "djF8Zg" },
      expect.anything()
    );
  });

  it("markNotificationAsRead: session が無ければ false", async () => {
    const { markNotificationAsRead } = await importNotifications();
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(markNotificationAsRead("TENANT001", "N001")).resolves.toBe(
      false
    );
  });

  it("markNotificationAsRead: API 成功時は true", async () => {
    const { markNotificationAsRead } = await importNotifications();
    mockMarkNotificationAsRead.mockResolvedValueOnce({ marked: true });

    await expect(markNotificationAsRead("TENANT001", "N001")).resolves.toBe(
      true
    );
  });

  it("markAllNotificationsAsRead: 件数を返す", async () => {
    const { markAllNotificationsAsRead } = await importNotifications();
    mockMarkAllNotificationsAsRead.mockResolvedValueOnce({ markedCount: 3 });

    await expect(markAllNotificationsAsRead("TENANT001")).resolves.toBe(3);
  });
});
