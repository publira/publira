import { Code, ConnectError } from "@publira/api-client/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockVerifyAdminPageSession, mockVerifyAdminSession } = vi.hoisted(
  () => ({
    mockVerifyAdminPageSession: vi.fn(() =>
      Promise.resolve({ locale: "en" as const, tenantId: "TENANT001" })
    ),
    mockVerifyAdminSession: vi.fn(),
  })
);

vi.mock("./admin-page-session", () => ({
  verifyAdminPageSession: mockVerifyAdminPageSession,
}));

vi.mock("./auth-session", () => ({
  verifyAdminSession: mockVerifyAdminSession,
}));

const { mockCacheLife, mockCacheTag, mockGetDashboardApi } = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetDashboardApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
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
    vi.stubEnv("PUBLIRA_WEB_SERVICE_TOKEN", "service-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fetches the dashboard data for the tenant id", async () => {
    mockGetDashboardApi.mockResolvedValueOnce({
      queue: [
        {
          episodePublicId: "EP001",
          episodeTitle: "Episode 1",
          scheduledAt: "2026-04-01T10:00:00Z",
          seriesPublicId: "SR001",
          seriesTitle: "Test Series",
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

    const result = await getDashboard();

    expect(result).toEqual({
      ok: true,
      queue: [
        {
          episodePublicId: "EP001",
          episodeTitle: "Episode 1",
          scheduledAt: "2026-04-01T10:00:00Z",
          seriesPublicId: "SR001",
          seriesTitle: "Test Series",
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
      expect.objectContaining({
        headers: { Authorization: "Bearer service-token" },
      })
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("falls back to the default values when stats is undefined", async () => {
    mockGetDashboardApi.mockResolvedValueOnce({ queue: [], stats: undefined });

    const { getDashboard } = await import("./dashboard");

    const result = await getDashboard();

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

  it("returns the shared wording for an unreachable error", async () => {
    mockGetDashboardApi.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { getDashboard } = await import("./dashboard");

    const result = await getDashboard();

    expect(result).toEqual({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports an RPC error it cannot classify instead of throwing from the cache scope", async () => {
    mockGetDashboardApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { getDashboard } = await import("./dashboard");

    const result = await getDashboard();

    expect(result.ok).toBe(false);
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("maps an episode in draft status", async () => {
    mockGetDashboardApi.mockResolvedValueOnce({
      queue: [
        {
          episodePublicId: "EP002",
          episodeTitle: "Episode 2",
          scheduledAt: "",
          seriesPublicId: "SR001",
          seriesTitle: "Test Series",
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

    const result = await getDashboard();

    if (!result.ok) {
      throw new Error("Expected ok result");
    }
    expect(result.queue[0].status).toBe("draft");
  });

  it("files the counts and the queue under the dashboard and episode tags", async () => {
    mockGetDashboardApi.mockResolvedValueOnce({ queue: [], stats: {} });

    const { getDashboard, tenantDashboardCacheTag } =
      await import("./dashboard");

    await getDashboard();

    expect(mockCacheTag).toHaveBeenCalledWith(
      tenantDashboardCacheTag("TENANT001")
    );
    expect(mockCacheTag).toHaveBeenCalledWith("episodes-TENANT001");
    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT001:series:detail");
  });

  it("tenantDashboardCacheTag normalizes the tenant id", async () => {
    const { tenantDashboardCacheTag } = await import("./dashboard");

    expect(tenantDashboardCacheTag("  TENANT001 ")).toBe(
      "tenant:TENANT001:dashboard"
    );
  });
});

describe("the operator check before a shared read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it.each([
    [
      "getDashboard",
      async () => {
        const { getDashboard } = await import("./dashboard");
        return await getDashboard();
      },
      mockGetDashboardApi,
    ],
  ] as const)(
    "%s confirms the operator of the screen's tenant before reading anything",
    async (_, read, rpc) => {
      const redirect = new Error("NEXT_REDIRECT");
      mockVerifyAdminPageSession.mockRejectedValueOnce(redirect);

      await expect(read()).rejects.toBe(redirect);
      expect(rpc).not.toHaveBeenCalled();
    }
  );
});
