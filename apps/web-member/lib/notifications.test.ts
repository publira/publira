import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockListNotifications,
  mockMarkAllNotificationsAsRead,
  mockMarkNotificationAsRead,
  mockResolveSessionId,
} = vi.hoisted(() => ({
  mockListNotifications: vi.fn(),
  mockMarkAllNotificationsAsRead: vi.fn(),
  mockMarkNotificationAsRead: vi.fn(),
  mockResolveSessionId: vi.fn(),
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
    headers: { "X-Publira-Session-Id": sessionId },
  }),
  resolveSessionId: mockResolveSessionId,
}));

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  unstable_noStore: vi.fn(),
}));

const importNotifications = () => import("./notifications");

describe("web-member notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSessionId.mockResolvedValue("sid_001");
  });

  it("listMyNotifications: API 応答を画面用に変換する", async () => {
    const { listMyNotifications } = await importNotifications();

    mockListNotifications.mockResolvedValueOnce({
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
    });

    await expect(listMyNotifications("TENANT001")).resolves.toEqual({
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
    });
  });

  it("markNotificationAsRead: session が無ければ false", async () => {
    const { markNotificationAsRead } = await importNotifications();
    mockResolveSessionId.mockResolvedValueOnce("");

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
