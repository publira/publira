import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPlatformDashboardSummary } from "./dashboard";

const {
  mockBuildSessionHeaders,
  mockGetDashboardSummary,
  mockResolveSessionId,
} = vi.hoisted(() => ({
  mockBuildSessionHeaders: vi.fn(),
  mockGetDashboardSummary: vi.fn(),
  mockResolveSessionId: vi.fn(),
}));

vi.mock("./api-client", () => ({
  apiClient: {
    dashboard: {
      getDashboardSummary: mockGetDashboardSummary,
    },
  },
  buildSessionHeaders: mockBuildSessionHeaders,
  resolveSessionId: mockResolveSessionId,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockResolveSessionId.mockResolvedValue("sess_dashboard");
  mockBuildSessionHeaders.mockImplementation((sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getPlatformDashboardSummary", () => {
  it("正常系: dashboard summary を整形して返す", async () => {
    mockGetDashboardSummary.mockResolvedValueOnce({
      activeTenants: 10,
      pendingEndUsers: 4,
      recentEvents: [
        {
          action: "Tenant Created",
          actor: "system",
          at: "2026-03-24T10:00:00Z",
          eventType: "tenant_created",
          target: "tenant_hoshikawa",
        },
      ],
      suspendedTenants: 2,
      totalTenants: 12,
    });

    await expect(
      getPlatformDashboardSummary({ recentEventsLimit: 6 })
    ).resolves.toEqual({
      ok: true,
      summary: {
        activeTenants: 10,
        pendingEndUsers: 4,
        recentEvents: [
          {
            action: "Tenant Created",
            actor: "system",
            at: "2026-03-24T10:00:00Z",
            eventType: "tenant_created",
            target: "tenant_hoshikawa",
          },
        ],
        suspendedTenants: 2,
        totalTenants: 12,
      },
    });

    expect(mockGetDashboardSummary).toHaveBeenCalledWith(
      { recentEventsLimit: 6 },
      { headers: { "Authorization": "Bearer sess_dashboard" } }
    );
  });

  it("件数上限外の recentEventsLimit はクランプして渡す", async () => {
    mockGetDashboardSummary.mockResolvedValueOnce({
      activeTenants: 0,
      pendingEndUsers: 0,
      recentEvents: [],
      suspendedTenants: 0,
      totalTenants: 0,
    });

    await getPlatformDashboardSummary({ recentEventsLimit: 999 });

    expect(mockGetDashboardSummary).toHaveBeenCalledWith(
      { recentEventsLimit: 50 },
      { headers: { "Authorization": "Bearer sess_dashboard" } }
    );
  });

  it("sessionId を解決できない場合は API を呼ばずエラーを返す", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(getPlatformDashboardSummary()).resolves.toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
    });

    expect(mockGetDashboardSummary).not.toHaveBeenCalled();
  });

  it("API エラー時はメッセージを返す", async () => {
    mockGetDashboardSummary.mockRejectedValueOnce(new Error("network error"));

    await expect(getPlatformDashboardSummary()).resolves.toEqual({
      message: "network error",
      ok: false,
    });
  });
});
