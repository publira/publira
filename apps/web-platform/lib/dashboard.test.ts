import { Code, ConnectError } from "@publira/api-client/errors";
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
  resolveAccessToken: mockResolveSessionId,
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
  it("formats and returns the dashboard summary", async () => {
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
      getPlatformDashboardSummary({ locale: "en", recentEventsLimit: 6 })
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
      { headers: { Authorization: "Bearer sess_dashboard" } }
    );
  });

  it("clamps recentEventsLimit outside the allowed range", async () => {
    mockGetDashboardSummary.mockResolvedValueOnce({
      activeTenants: 0,
      pendingEndUsers: 0,
      recentEvents: [],
      suspendedTenants: 0,
      totalTenants: 0,
    });

    await getPlatformDashboardSummary({ locale: "en", recentEventsLimit: 999 });

    expect(mockGetDashboardSummary).toHaveBeenCalledWith(
      { recentEventsLimit: 50 },
      { headers: { Authorization: "Bearer sess_dashboard" } }
    );
  });

  it("returns an error without calling the API when sessionId cannot be resolved", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(
      getPlatformDashboardSummary({ locale: "en" })
    ).resolves.toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });

    expect(mockGetDashboardSummary).not.toHaveBeenCalled();
  });

  it("words the session error in the requested locale, so locale=ja is Japanese", async () => {
    mockResolveSessionId.mockResolvedValueOnce("");

    await expect(
      getPlatformDashboardSummary({ locale: "ja" })
    ).resolves.toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
    });
  });

  it("returns a shared message for unavailable errors", async () => {
    mockGetDashboardSummary.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    await expect(
      getPlatformDashboardSummary({ locale: "en" })
    ).resolves.toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
      requiresSignIn: false,
    });
  });

  it("propagates unclassified RPC errors", async () => {
    mockGetDashboardSummary.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(getPlatformDashboardSummary({ locale: "en" })).rejects.toThrow(
      "boom"
    );
  });
});
