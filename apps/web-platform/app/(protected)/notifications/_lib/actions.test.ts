import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockMarkAllNotificationsAsRead,
  mockMarkNotificationAsRead,
  mockResolveAccessToken,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockMarkAllNotificationsAsRead: vi.fn(),
  mockMarkNotificationAsRead: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("#lib/notification", () => ({
  markAllNotificationsAsRead: mockMarkAllNotificationsAsRead,
  markNotificationAsRead: mockMarkNotificationAsRead,
  notificationsCacheTag: "platform:notifications",
}));

const formData = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
};

const notificationId = "11111111-1111-4111-8111-111111111111";

describe("notification actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // `withPlatformSessionReauth` resolves the session before the mutation
    // runs; without a token every Action under test would redirect to /login.
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("単件既読に成功したらキャッシュタグを更新する", async () => {
    mockMarkNotificationAsRead.mockResolvedValueOnce({ ok: true });

    const { markNotificationAsReadAction } = await import("./actions");
    const result = await markNotificationAsReadAction(
      null,
      formData({ notification_id: notificationId })
    );

    expect(result).toEqual({ message: "既読にしました。", ok: true });
    expect(mockMarkNotificationAsRead).toHaveBeenCalledWith({
      notificationId,
    });
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:notifications");
  });

  it("不正な notification_id は API を呼ばない", async () => {
    const { markNotificationAsReadAction } = await import("./actions");
    const result = await markNotificationAsReadAction(
      null,
      formData({ notification_id: "not-a-uuid" })
    );

    expect(result).toEqual({
      message: "入力内容を確認してください。",
      ok: false,
    });
    expect(mockMarkNotificationAsRead).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("全件既読に成功したらキャッシュタグを更新する", async () => {
    mockMarkAllNotificationsAsRead.mockResolvedValueOnce({
      markedCount: 2,
      ok: true,
    });

    const { markAllNotificationsAsReadAction } = await import("./actions");
    const result = await markAllNotificationsAsReadAction(null, formData({}));

    expect(result).toEqual({
      message: "未読をすべて既読にしました。",
      ok: true,
    });
    expect(mockMarkAllNotificationsAsRead).toHaveBeenCalledWith();
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:notifications");
  });

  it("API が拒否したらメッセージを返し、タグは更新しない", async () => {
    mockMarkAllNotificationsAsRead.mockResolvedValueOnce({
      message: "この操作を行う権限がありません。",
      ok: false,
    });

    const { markAllNotificationsAsReadAction } = await import("./actions");
    const result = await markAllNotificationsAsReadAction(null, formData({}));

    expect(result).toEqual({
      message: "この操作を行う権限がありません。",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
