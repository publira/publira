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

vi.mock("#lib/locale", () => ({
  getPlatformLocale: () => Promise.resolve("en"),
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

  it("updates cache tags after marking one notification as read", async () => {
    mockMarkNotificationAsRead.mockResolvedValueOnce({ ok: true });

    const { markNotificationAsReadAction } = await import("./actions");
    const result = await markNotificationAsReadAction(
      null,
      formData({ notification_id: notificationId })
    );

    expect(result).toEqual({ ok: true });
    expect(mockMarkNotificationAsRead).toHaveBeenCalledWith(
      { notificationId },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:notifications");
  });

  it("does not call the API for an invalid notification_id", async () => {
    const { markNotificationAsReadAction } = await import("./actions");
    const result = await markNotificationAsReadAction(
      null,
      formData({ notification_id: "not-a-uuid" })
    );

    expect(result).toEqual({
      message: "Please check the information you entered.",
      ok: false,
    });
    expect(mockMarkNotificationAsRead).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("updates cache tags after marking all notifications as read", async () => {
    mockMarkAllNotificationsAsRead.mockResolvedValueOnce({
      markedCount: 2,
      ok: true,
    });

    const { markAllNotificationsAsReadAction } = await import("./actions");
    const result = await markAllNotificationsAsReadAction(null, formData({}));

    expect(result).toEqual({ ok: true });
    expect(mockMarkAllNotificationsAsRead).toHaveBeenCalledWith("en");
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:notifications");
  });

  it("returns a message without updating tags when the API rejects", async () => {
    mockMarkAllNotificationsAsRead.mockResolvedValueOnce({
      message: "You do not have permission to perform this action.",
      ok: false,
    });

    const { markAllNotificationsAsReadAction } = await import("./actions");
    const result = await markAllNotificationsAsReadAction(null, formData({}));

    expect(result).toEqual({
      message: "You do not have permission to perform this action.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
