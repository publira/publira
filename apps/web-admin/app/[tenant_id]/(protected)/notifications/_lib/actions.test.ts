import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetAccessToken,
  mockMarkAllNotificationsAsRead,
  mockMarkNotificationAsRead,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockMarkAllNotificationsAsRead: vi.fn(),
  mockMarkNotificationAsRead: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("#lib/action-messages", async () => {
  const { sharedCatalog } = await import("@publira/i18n/catalog");
  return {
    getActionLocale: () => Promise.resolve("en"),
    getActionMessages: () => Promise.resolve(sharedCatalog("en")),
  };
});

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/notification", () => ({
  markAllNotificationsAsRead: mockMarkAllNotificationsAsRead,
  markNotificationAsRead: mockMarkNotificationAsRead,
  notificationsCacheTag: (tenantId: string) => `notifications-${tenantId}`,
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
    // `withAdminSessionReauth` resolves the session before the mutation runs;
    // without a token every Action under test would redirect to /login.
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("revalidates the cache tag after marking one notification as read", async () => {
    mockMarkNotificationAsRead.mockResolvedValueOnce({ ok: true });

    const { markNotificationAsReadAction } = await import("./actions");
    const result = await markNotificationAsReadAction(
      null,
      formData({
        notification_id: notificationId,
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({ ok: true });
    expect(mockMarkNotificationAsRead).toHaveBeenCalledWith(
      {
        notificationId,
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("notifications-TENANT001");
  });

  it("does not call the API for an invalid notification_id", async () => {
    const { markNotificationAsReadAction } = await import("./actions");
    const result = await markNotificationAsReadAction(
      null,
      formData({
        notification_id: "not-a-uuid",
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({
      message: "Please check the information you entered.",
      ok: false,
    });
    expect(mockMarkNotificationAsRead).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("revalidates the cache tag after marking every notification as read", async () => {
    mockMarkAllNotificationsAsRead.mockResolvedValueOnce({
      markedCount: 2,
      ok: true,
    });

    const { markAllNotificationsAsReadAction } = await import("./actions");
    const result = await markAllNotificationsAsReadAction(
      null,
      formData({ tenant_id: "TENANT001" })
    );

    expect(result).toEqual({ ok: true });
    expect(mockMarkAllNotificationsAsRead).toHaveBeenCalledWith(
      "TENANT001",
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("notifications-TENANT001");
  });

  it("returns the message and leaves the cache tag alone when the API rejects the call", async () => {
    mockMarkAllNotificationsAsRead.mockResolvedValueOnce({
      message: "You do not have permission to perform this action.",
      ok: false,
    });

    const { markAllNotificationsAsReadAction } = await import("./actions");
    const result = await markAllNotificationsAsReadAction(
      null,
      formData({ tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      message: "You do not have permission to perform this action.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
