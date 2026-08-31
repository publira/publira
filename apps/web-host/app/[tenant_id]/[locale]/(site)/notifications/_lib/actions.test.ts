import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockMarkAllNotificationsAsRead,
  mockMarkNotificationAsRead,
  mockRequirePublicSession,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockMarkAllNotificationsAsRead: vi.fn(),
  mockMarkNotificationAsRead: vi.fn(),
  mockRequirePublicSession: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/notification", () => ({
  markAllNotificationsAsRead: mockMarkAllNotificationsAsRead,
  markNotificationAsRead: mockMarkNotificationAsRead,
  notificationsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:notifications`,
}));

vi.mock("#lib/auth-session", () => ({
  requirePublicSession: mockRequirePublicSession,
  withPublicSessionReauth: (
    _locale: string,
    _returnTo: string,
    run: () => Promise<unknown>
  ) => run(),
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

const formData = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
};

const notificationId = "11111111-1111-4111-8111-111111111111";
const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("notification actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockRequirePublicSession.mockResolvedValue("session-token");
  });

  it("Update the cache tag when a single item is successfully read", async () => {
    mockMarkNotificationAsRead.mockResolvedValueOnce({ ok: true });

    const { markNotificationAsReadAction } = await import("./actions");
    const result = await markNotificationAsReadAction(
      null,
      formData({
        notificationId,
        tenantId,
      })
    );

    expect(result).toEqual({ message: "既読にしました。", ok: true });
    expect(mockMarkNotificationAsRead).toHaveBeenCalledWith({
      locale: "ja",
      notificationId,
      tenantId,
    });
    expect(mockRequirePublicSession).toHaveBeenCalledWith(
      "ja",
      "/notifications",
      tenantId
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      `tenant:${tenantId}:notifications`
    );
  });

  it("Invalid notificationId will not call API", async () => {
    const { markNotificationAsReadAction } = await import("./actions");
    const result = await markNotificationAsReadAction(
      null,
      formData({
        notificationId: "not-a-uuid",
        tenantId,
      })
    );

    expect(result).toEqual({
      message: "入力内容を確認してください。",
      ok: false,
    });
    expect(mockMarkNotificationAsRead).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("If all items are successfully read, update the cache tag.", async () => {
    mockMarkAllNotificationsAsRead.mockResolvedValueOnce({
      markedCount: 2,
      ok: true,
    });

    const { markAllNotificationsAsReadAction } = await import("./actions");
    const result = await markAllNotificationsAsReadAction(
      null,
      formData({ tenantId })
    );

    expect(result).toEqual({
      message: "未読をすべて既読にしました。",
      ok: true,
    });
    expect(mockMarkAllNotificationsAsRead).toHaveBeenCalledWith(tenantId, "ja");
    expect(mockRequirePublicSession).toHaveBeenCalledWith(
      "ja",
      "/notifications",
      tenantId
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      `tenant:${tenantId}:notifications`
    );
  });

  it("If the API rejects, return a message and do not update the tag.", async () => {
    mockMarkAllNotificationsAsRead.mockResolvedValueOnce({
      message: "この操作を行う権限がありません。",
      ok: false,
    });

    const { markAllNotificationsAsReadAction } = await import("./actions");
    const result = await markAllNotificationsAsReadAction(
      null,
      formData({ tenantId })
    );

    expect(result).toEqual({
      message: "この操作を行う権限がありません。",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
