import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSessionId, mockGetDashboardApi } = vi.hoisted(() => ({
  mockGetDashboardApi: vi.fn(),
  mockGetSessionId: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetSessionId,
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => ({
    dashboard: {
      getDashboard: mockGetDashboardApi,
    },
  }),
}));

describe("dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
  });

  it("fetches the dashboard data for the tenant id", async () => {
    mockGetDashboardApi.mockResolvedValueOnce({
      queue: [
        {
          episodePublicId: "EP001",
          episodeTitle: "第1話",
          scheduledAt: "2026-04-01T10:00:00Z",
          seriesPublicId: "SR001",
          seriesTitle: "テストシリーズ",
          status: "scheduled",
        },
      ],
      stats: {
        draftEpisodeCount: 3,
        publishedSeriesCount: 5,
        scheduledEpisodeCount: 2,
      },
    });

    const { getDashboard } = await import("./dashboard");

    const result = await getDashboard("TENANT001");

    expect(result).toEqual({
      ok: true,
      queue: [
        {
          episodePublicId: "EP001",
          episodeTitle: "第1話",
          scheduledAt: "2026-04-01T10:00:00Z",
          seriesPublicId: "SR001",
          seriesTitle: "テストシリーズ",
          status: "scheduled",
        },
      ],
      stats: {
        draftEpisodeCount: 3,
        publishedSeriesCount: 5,
        scheduledEpisodeCount: 2,
      },
    });

    expect(mockGetDashboardApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("falls back to the default values when stats is undefined", async () => {
    mockGetDashboardApi.mockResolvedValueOnce({ queue: [], stats: undefined });

    const { getDashboard } = await import("./dashboard");

    const result = await getDashboard("TENANT001");

    expect(result).toEqual({
      ok: true,
      queue: [],
      stats: {
        draftEpisodeCount: 0,
        publishedSeriesCount: 0,
        scheduledEpisodeCount: 0,
      },
    });
  });

  it("returns an error when there is no session", async () => {
    mockGetSessionId.mockResolvedValue("");

    const { getDashboard } = await import("./dashboard");

    const result = await getDashboard("TENANT001");

    expect(result).toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetDashboardApi).not.toHaveBeenCalled();
  });

  it("returns an error on an unauthenticated API error", async () => {
    mockGetDashboardApi.mockRejectedValueOnce(
      new ConnectError("invalid session", Code.Unauthenticated)
    );

    const { getDashboard } = await import("./dashboard");

    const result = await getDashboard("TENANT001");

    expect(result).toEqual({
      message: "セッションが無効です。再ログインしてください。",
      ok: false,
      requiresSignIn: true,
    });
  });

  it("returns the shared wording for an unreachable error", async () => {
    mockGetDashboardApi.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { getDashboard } = await import("./dashboard");

    const result = await getDashboard("TENANT001");

    expect(result).toEqual({
      message:
        "サーバーに接続できませんでした。時間をおいて再試行してください。",
      ok: false,
      requiresSignIn: false,
    });
  });

  it("propagates an RPC error it cannot classify", async () => {
    mockGetDashboardApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { getDashboard } = await import("./dashboard");

    await expect(getDashboard("TENANT001")).rejects.toThrow("boom");
  });

  it("maps an episode in draft status", async () => {
    mockGetDashboardApi.mockResolvedValueOnce({
      queue: [
        {
          episodePublicId: "EP002",
          episodeTitle: "第2話",
          scheduledAt: "",
          seriesPublicId: "SR001",
          seriesTitle: "テストシリーズ",
          status: "draft",
        },
      ],
      stats: {
        draftEpisodeCount: 1,
        publishedSeriesCount: 0,
        scheduledEpisodeCount: 0,
      },
    });

    const { getDashboard } = await import("./dashboard");

    const result = await getDashboard("TENANT001");

    if (!result.ok) {
      throw new Error("Expected ok result");
    }
    expect(result.queue[0].status).toBe("draft");
  });
});
