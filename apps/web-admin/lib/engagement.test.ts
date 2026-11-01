import {
  AudienceGroupBy,
  RevenueGroupBy,
  StatsExportKind,
} from "@publira/api-client/admin/engagement";
import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockExportStatsApi,
  mockGetAudienceStatsApi,
  mockGetEpisodeDropOffApi,
  mockGetRetentionCohortsApi,
  mockGetRevenueStatsApi,
  mockGetSessionId,
  mockGetSignUpFunnelApi,
  mockListEpisodeReadThroughApi,
} = vi.hoisted(() => ({
  mockExportStatsApi: vi.fn(),
  mockGetAudienceStatsApi: vi.fn(),
  mockGetEpisodeDropOffApi: vi.fn(),
  mockGetRetentionCohortsApi: vi.fn(),
  mockGetRevenueStatsApi: vi.fn(),
  mockGetSessionId: vi.fn(),
  mockGetSignUpFunnelApi: vi.fn(),
  mockListEpisodeReadThroughApi: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetSessionId,
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => ({
    engagement: {
      exportStats: mockExportStatsApi,
      getAudienceStats: mockGetAudienceStatsApi,
      getEpisodeDropOff: mockGetEpisodeDropOffApi,
      getRetentionCohorts: mockGetRetentionCohortsApi,
      getRevenueStats: mockGetRevenueStatsApi,
      getSignUpFunnel: mockGetSignUpFunnelApi,
      listEpisodeReadThrough: mockListEpisodeReadThroughApi,
    },
  }),
}));

/**
 * Both counts are int64, so the wire value is a `bigint` and the mapper is what
 * narrows it. A fixture that already held a `number` on both sides never ran
 * that conversion. (`BigInt(...)` rather than `7n`: the app's TypeScript target
 * is ES2017, which has no bigint literal.)
 */
const episodeCompleteCount = 7;
const episodeMemberViewCount = 20;
const totalCompleteCount = 9;
const totalMemberViewCount = 30;
const noCount = 0;

describe("engagement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
  });

  it("maps the episodes, the period, and the period totals", async () => {
    mockListEpisodeReadThroughApi.mockResolvedValueOnce({
      episodes: [
        {
          completeCount: BigInt(episodeCompleteCount),
          episodePublicId: "EP001",
          episodeTitle: "Episode 1",
          memberViewCount: BigInt(episodeMemberViewCount),
          seriesPublicId: "SR001",
          seriesTitle: "Test Series",
        },
      ],
      nextToken: "next",
      periodEnd: "2026-03-14",
      periodStart: "2026-02-15",
      previousToken: "",
      timeZone: "UTC",
      totalCompleteCount: BigInt(totalCompleteCount),
      totalMemberViewCount: BigInt(totalMemberViewCount),
    });

    const { listEpisodeReadThrough } = await import("./engagement");

    const result = await listEpisodeReadThrough("TENANT001", "en");

    expect(result).toEqual({
      episodes: [
        {
          completeCount: 7,
          episodePublicId: "EP001",
          episodeTitle: "Episode 1",
          memberViewCount: 20,
          seriesPublicId: "SR001",
          seriesTitle: "Test Series",
        },
      ],
      nextToken: "next",
      ok: true,
      period: {
        end: "2026-03-14",
        start: "2026-02-15",
        timeZone: "UTC",
      },
      previousToken: "",
      totalCompleteCount: 9,
      totalMemberViewCount: 30,
    });
    expect(mockListEpisodeReadThroughApi).toHaveBeenCalledWith(
      { limit: 20, tenant: { tenantId: "TENANT001" }, token: "" },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("passes the cursor token through unchanged", async () => {
    mockListEpisodeReadThroughApi.mockResolvedValueOnce({
      episodes: [],
      nextToken: "",
      periodEnd: "2026-03-14",
      periodStart: "2026-02-15",
      previousToken: "back",
      totalCompleteCount: BigInt(noCount),
      totalMemberViewCount: BigInt(noCount),
    });

    const { listEpisodeReadThrough } = await import("./engagement");

    await listEpisodeReadThrough("TENANT001", "en", { token: "opaque" });

    expect(mockListEpisodeReadThroughApi).toHaveBeenCalledWith(
      { limit: 20, tenant: { tenantId: "TENANT001" }, token: "opaque" },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("returns an error when there is no session", async () => {
    mockGetSessionId.mockResolvedValue("");

    const { listEpisodeReadThrough } = await import("./engagement");

    const result = await listEpisodeReadThrough("TENANT001", "en");

    expect(result).toEqual({
      episodes: [],
      message: "Your session is no longer valid. Please sign in again.",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: true,
    });
    expect(mockListEpisodeReadThroughApi).not.toHaveBeenCalled();
  });

  it("returns the shared wording for an unreachable error", async () => {
    mockListEpisodeReadThroughApi.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { listEpisodeReadThrough } = await import("./engagement");

    const result = await listEpisodeReadThrough("TENANT001", "en");

    expect(result).toEqual({
      episodes: [],
      message: "Could not connect to the server. Please try again later.",
      nextToken: "",
      ok: false,
      previousToken: "",
      requiresSignIn: false,
    });
  });

  it("propagates an RPC error it cannot classify", async () => {
    mockListEpisodeReadThroughApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { listEpisodeReadThrough } = await import("./engagement");

    await expect(listEpisodeReadThrough("TENANT001", "en")).rejects.toThrow(
      "boom"
    );
  });
});

describe("readThroughRate", () => {
  it("divides completions by the member views of the same period", async () => {
    const { readThroughRate } = await import("./engagement");

    expect(readThroughRate(7, 20)).toBeCloseTo(0.35);
  });

  it("answers null rather than zero when nobody viewed", async () => {
    const { readThroughRate } = await import("./engagement");

    expect(readThroughRate(0, 0)).toBeNull();
  });
});

const sessionHeaders = { headers: { Authorization: "Bearer session-token" } };

const period = { endDate: "2026-10-24", startDate: "2026-09-27" };

const seriesRevenueRow = (publicId: string) => ({
  grossAmount: 100n,
  netAmount: 100n,
  purchaseCount: 1n,
  refundedAmount: 0n,
  seriesPublicId: publicId,
  seriesTitle: publicId,
});

describe("getRevenueStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
  });

  it("maps a day report, its totals, its currency, and its period", async () => {
    mockGetRevenueStatsApi.mockResolvedValueOnce({
      ...period,
      currency: "JPY",
      nextToken: "",
      rows: [
        {
          date: "2026-09-27",
          episodePublicId: "",
          episodeTitle: "",
          grossAmount: 1200n,
          netAmount: 900n,
          purchaseCount: 3n,
          refundedAmount: 300n,
          seriesPublicId: "",
          seriesTitle: "",
          subscriptionAmount: 980n,
          subscriptionRefundedAmount: 100n,
        },
      ],
      timeZone: "Asia/Tokyo",
      totals: {
        grossAmount: 1200n,
        netAmount: 900n,
        purchaseCount: 3n,
        refundedAmount: 300n,
        subscriptionAmount: 980n,
        subscriptionRefundedAmount: 100n,
      },
    });

    const { getRevenueStats } = await import("./engagement");

    const result = await getRevenueStats("TENANT001", "en", {
      end: "2026-10-24",
      group: "day",
      start: "2026-09-27",
    });

    expect(result).toEqual({
      currency: "JPY",
      ok: true,
      period: {
        end: "2026-10-24",
        start: "2026-09-27",
        timeZone: "Asia/Tokyo",
      },
      rows: [
        {
          date: "2026-09-27",
          episodePublicId: "",
          episodeTitle: "",
          grossAmount: 1200,
          netAmount: 900,
          purchaseCount: 3,
          refundedAmount: 300,
          seriesPublicId: "",
          seriesTitle: "",
          subscriptionAmount: 980,
          subscriptionRefundedAmount: 100,
        },
      ],
      totals: {
        grossAmount: 1200,
        netAmount: 900,
        purchaseCount: 3,
        refundedAmount: 300,
        subscriptionAmount: 980,
        subscriptionRefundedAmount: 100,
      },
    });
    expect(mockGetRevenueStatsApi).toHaveBeenCalledWith(
      {
        endDate: "2026-10-24",
        groupBy: RevenueGroupBy.DAY,
        limit: 100,
        startDate: "2026-09-27",
        tenant: { tenantId: "TENANT001" },
        token: "",
      },
      sessionHeaders
    );
  });

  it("reads a breakdown through every page, so it can be sorted whole", async () => {
    mockGetRevenueStatsApi
      .mockResolvedValueOnce({
        ...period,
        currency: "JPY",
        nextToken: "page-2",
        rows: [seriesRevenueRow("SR001")],
        timeZone: "UTC",
      })
      .mockResolvedValueOnce({
        ...period,
        currency: "JPY",
        nextToken: "",
        rows: [seriesRevenueRow("SR002")],
        timeZone: "UTC",
      });

    const { getRevenueStats } = await import("./engagement");

    const result = await getRevenueStats("TENANT001", "en", {
      end: "2026-10-24",
      group: "series",
      start: "2026-09-27",
    });

    expect(result.ok && result.rows.map((row) => row.seriesPublicId)).toEqual([
      "SR001",
      "SR002",
    ]);
    expect(mockGetRevenueStatsApi).toHaveBeenCalledTimes(2);
    expect(mockGetRevenueStatsApi).toHaveBeenLastCalledWith(
      expect.objectContaining({
        groupBy: RevenueGroupBy.SERIES,
        token: "page-2",
      }),
      sessionHeaders
    );
  });

  it("asks for sign-in without a session", async () => {
    mockGetSessionId.mockResolvedValue("");

    const { getRevenueStats } = await import("./engagement");

    const result = await getRevenueStats("TENANT001", "en", {
      end: "2026-10-24",
      group: "day",
      start: "2026-09-27",
    });

    expect(result).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetRevenueStatsApi).not.toHaveBeenCalled();
  });

  it("words a refused role with the shared copy", async () => {
    mockGetRevenueStatsApi.mockRejectedValueOnce(
      new ConnectError("denied", Code.PermissionDenied)
    );

    const { getRevenueStats } = await import("./engagement");

    const result = await getRevenueStats("TENANT001", "en", {
      end: "2026-10-24",
      group: "day",
      start: "2026-09-27",
    });

    expect(result).toMatchObject({ ok: false, requiresSignIn: false });
  });
});

describe("getAudienceStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
  });

  it("maps a series report, an unrated series' rating to no rating", async () => {
    mockGetAudienceStatsApi.mockResolvedValueOnce({
      ...period,
      nextToken: "",
      rows: [
        {
          completeCount: 4n,
          followedCount: 2n,
          followerCount: 10n,
          ratingAverage: 4.2,
          ratingCount: 5n,
          reactionCount: 7n,
          seriesPublicId: "SR001",
          seriesTitle: "Rated",
          unfollowedCount: 1n,
          viewCount: 40n,
        },
        {
          completeCount: 0n,
          followedCount: 0n,
          followerCount: 0n,
          ratingAverage: 0,
          ratingCount: 0n,
          reactionCount: 0n,
          seriesPublicId: "SR002",
          seriesTitle: "Unrated",
          unfollowedCount: 0n,
          viewCount: 0n,
        },
      ],
      timeZone: "UTC",
      totals: {
        completeCount: 4n,
        followedCount: 2n,
        followerCount: 10n,
        reactionCount: 7n,
        unfollowedCount: 1n,
        viewCount: 40n,
      },
    });

    const { getAudienceStats } = await import("./engagement");

    const result = await getAudienceStats("TENANT001", "en", {
      end: "2026-10-24",
      group: "series",
      start: "2026-09-27",
    });

    expect(result.ok && result.rows).toEqual([
      expect.objectContaining({
        followerCount: 10,
        ratingAverage: 4.2,
        ratingCount: 5,
        seriesPublicId: "SR001",
        viewCount: 40,
      }),
      expect.objectContaining({ ratingAverage: null, seriesPublicId: "SR002" }),
    ]);
    expect(result.ok && result.totals.followerCount).toBe(10);
    expect(mockGetAudienceStatsApi).toHaveBeenCalledWith(
      expect.objectContaining({ groupBy: AudienceGroupBy.SERIES, limit: 100 }),
      sessionHeaders
    );
  });
});

describe("getEpisodeDropOff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
  });

  it("maps the pages, the episode's page count, and the period", async () => {
    mockGetEpisodeDropOffApi.mockResolvedValueOnce({
      ...period,
      pageCount: 2,
      pages: [
        { pageIndex: 0, readerCount: 10n },
        { pageIndex: 1, readerCount: 6n },
      ],
      timeZone: "UTC",
    });

    const { getEpisodeDropOff } = await import("./engagement");

    const result = await getEpisodeDropOff("TENANT001", "en", {
      end: "2026-10-24",
      episodePublicId: "EP001",
      start: "2026-09-27",
    });

    expect(result).toEqual({
      ok: true,
      pageCount: 2,
      pages: [
        { pageIndex: 0, readerCount: 10 },
        { pageIndex: 1, readerCount: 6 },
      ],
      period: { end: "2026-10-24", start: "2026-09-27", timeZone: "UTC" },
    });
    expect(mockGetEpisodeDropOffApi).toHaveBeenCalledWith(
      {
        endDate: "2026-10-24",
        episodePublicId: "EP001",
        startDate: "2026-09-27",
        tenant: { tenantId: "TENANT001" },
      },
      sessionHeaders
    );
  });

  it("answers not found for an episode the tenant does not have", async () => {
    mockGetEpisodeDropOffApi.mockRejectedValueOnce(
      new ConnectError("no such episode", Code.NotFound)
    );

    const { getEpisodeDropOff } = await import("./engagement");

    const result = await getEpisodeDropOff("TENANT001", "en", {
      end: "2026-10-24",
      episodePublicId: "EP404",
      start: "2026-09-27",
    });

    expect(result).toEqual({ notFound: true, ok: false });
  });
});

describe("getRetentionCohorts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
  });

  it("maps each week's cohort and its active counts, and passes the series", async () => {
    mockGetRetentionCohortsApi.mockResolvedValueOnce({
      cohorts: [
        { activeCounts: [3n, 1n], cohortSize: 4n, weekStart: "2026-09-21" },
        { activeCounts: [], cohortSize: 0n, weekStart: "2026-09-28" },
      ],
      ...period,
      timeZone: "Asia/Tokyo",
    });

    const { getRetentionCohorts } = await import("./engagement");

    const result = await getRetentionCohorts("TENANT001", "en", {
      end: "2026-10-24",
      seriesPublicId: "SER001",
      start: "2026-09-27",
    });

    expect(result).toEqual({
      cohorts: [
        { activeCounts: [3, 1], cohortSize: 4, weekStart: "2026-09-21" },
        { activeCounts: [], cohortSize: 0, weekStart: "2026-09-28" },
      ],
      ok: true,
      period: {
        end: "2026-10-24",
        start: "2026-09-27",
        timeZone: "Asia/Tokyo",
      },
    });
    expect(mockGetRetentionCohortsApi).toHaveBeenCalledWith(
      {
        endDate: "2026-10-24",
        seriesPublicId: "SER001",
        startDate: "2026-09-27",
        tenant: { tenantId: "TENANT001" },
      },
      sessionHeaders
    );
  });

  it("asks for sign-in without a session", async () => {
    mockGetSessionId.mockResolvedValue("");

    const { getRetentionCohorts } = await import("./engagement");

    const result = await getRetentionCohorts("TENANT001", "en", {
      end: "2026-10-24",
      seriesPublicId: "",
      start: "2026-09-27",
    });

    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockGetRetentionCohortsApi).not.toHaveBeenCalled();
  });
});

describe("getSignUpFunnel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
  });

  it("maps every step and the median", async () => {
    mockGetSignUpFunnelApi.mockResolvedValueOnce({
      ...period,
      activeCount: 6n,
      medianDaysToFirstPurchase: 2.5,
      purchasedCount: 3n,
      purchasedWithinSevenDaysCount: 2n,
      purchasedWithinThirtyDaysCount: 3n,
      signedUpCount: 10n,
      timeZone: "UTC",
    });

    const { getSignUpFunnel } = await import("./engagement");

    const result = await getSignUpFunnel("TENANT001", "en", {
      end: "2026-10-24",
      start: "2026-09-27",
    });

    expect(result).toEqual({
      funnel: {
        activeCount: 6,
        medianDaysToFirstPurchase: 2.5,
        purchasedCount: 3,
        purchasedWithinSevenDaysCount: 2,
        purchasedWithinThirtyDaysCount: 3,
        signedUpCount: 10,
      },
      ok: true,
      period: { end: "2026-10-24", start: "2026-09-27", timeZone: "UTC" },
    });
  });

  it("has no median when nobody has bought", async () => {
    mockGetSignUpFunnelApi.mockResolvedValueOnce({
      ...period,
      medianDaysToFirstPurchase: 0,
      purchasedCount: 0n,
      signedUpCount: 2n,
      timeZone: "UTC",
    });

    const { getSignUpFunnel } = await import("./engagement");

    const result = await getSignUpFunnel("TENANT001", "en", {
      end: "2026-10-24",
      start: "2026-09-27",
    });

    expect(result).toMatchObject({
      funnel: { medianDaysToFirstPurchase: null, purchasedCount: 0 },
      ok: true,
    });
  });

  it("words a refused role with the shared copy", async () => {
    mockGetSignUpFunnelApi.mockRejectedValueOnce(
      new ConnectError("denied", Code.PermissionDenied)
    );

    const { getSignUpFunnel } = await import("./engagement");

    const result = await getSignUpFunnel("TENANT001", "en", {
      end: "2026-10-24",
      start: "2026-09-27",
    });

    expect(result).toMatchObject({ ok: false, requiresSignIn: false });
  });
});

const week = { end: "2025-03-09", start: "2025-03-03" };

const dropOff = {
  episodePublicId: "EP001",
  kind: "drop_off",
  seriesPublicId: "SER001",
} as const;

describe("exportStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
  });

  it.each([
    [{ group: "day", kind: "revenue" }, StatsExportKind.REVENUE_BY_DAY],
    [{ group: "series", kind: "revenue" }, StatsExportKind.REVENUE_BY_SERIES],
    [{ group: "episode", kind: "revenue" }, StatsExportKind.REVENUE_BY_EPISODE],
    [{ group: "day", kind: "audience" }, StatsExportKind.AUDIENCE_BY_DAY],
    [{ group: "series", kind: "audience" }, StatsExportKind.AUDIENCE_BY_SERIES],
  ] as const)("asks for the report a table shows: %o", async (report, kind) => {
    const csv = new TextEncoder().encode("date\r\n");
    mockExportStatsApi.mockResolvedValueOnce({ csv });

    const { exportStats } = await import("./engagement");

    await expect(exportStats("TENANT001", report, week)).resolves.toEqual({
      csv,
      ok: true,
    });
    expect(mockExportStatsApi).toHaveBeenCalledWith(
      {
        endDate: "2025-03-09",
        kind,
        startDate: "2025-03-03",
        tenant: { tenantId: "TENANT001" },
      },
      sessionHeaders
    );
  });

  it("names the episode of a drop-off and nothing else", async () => {
    mockExportStatsApi.mockResolvedValueOnce({ csv: new Uint8Array() });

    const { exportStats } = await import("./engagement");

    await exportStats("TENANT001", dropOff, week);

    expect(mockExportStatsApi).toHaveBeenCalledWith(
      {
        endDate: "2025-03-09",
        episodePublicId: "EP001",
        kind: StatsExportKind.EPISODE_DROP_OFF,
        startDate: "2025-03-03",
        tenant: { tenantId: "TENANT001" },
      },
      sessionHeaders
    );
  });

  it("answers signed out without a session, and asks the API nothing", async () => {
    mockGetSessionId.mockResolvedValueOnce(undefined);

    const { exportStats } = await import("./engagement");

    await expect(
      exportStats("TENANT001", { group: "day", kind: "revenue" }, week)
    ).resolves.toEqual({ ok: false, reason: "signedOut" });
    expect(mockExportStatsApi).not.toHaveBeenCalled();
  });

  it("answers signed out for a session the API rejects", async () => {
    mockExportStatsApi.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    const { exportStats } = await import("./engagement");

    await expect(
      exportStats("TENANT001", { group: "day", kind: "revenue" }, week)
    ).resolves.toEqual({ ok: false, reason: "signedOut" });
  });

  it.each([
    ["an episode the tenant does not have", Code.NotFound],
    ["a role below tenant admin", Code.PermissionDenied],
    ["a period the API refuses", Code.InvalidArgument],
  ])("answers missing for %s", async (_label, code) => {
    mockExportStatsApi.mockRejectedValueOnce(new ConnectError("refused", code));

    const { exportStats } = await import("./engagement");

    await expect(exportStats("TENANT001", dropOff, week)).resolves.toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("lets any other failure reach the error boundary", async () => {
    mockExportStatsApi.mockRejectedValueOnce(
      new ConnectError("database down", Code.Unavailable)
    );

    const { exportStats } = await import("./engagement");

    await expect(
      exportStats("TENANT001", { group: "day", kind: "revenue" }, week)
    ).rejects.toThrow("database down");
  });
});

describe("statsCsvPath", () => {
  it("is the screen's path under the API, with the period spelled out", async () => {
    const { statsCsvPath } = await import("./engagement");

    expect(statsCsvPath({ group: "series", kind: "revenue" }, week)).toBe(
      "/api/v1/analytics/revenue/csv?from=2025-03-03&group=series&to=2025-03-09"
    );
    expect(statsCsvPath({ group: "day", kind: "audience" }, week)).toBe(
      "/api/v1/analytics/audience/csv?from=2025-03-03&to=2025-03-09"
    );
    expect(statsCsvPath(dropOff, week)).toBe(
      "/api/v1/analytics/episodes/SER001/EP001/csv?from=2025-03-03&to=2025-03-09"
    );
  });
});

describe("statsReportHref", () => {
  it("is the screen that shows the report over the period", async () => {
    const { statsReportHref } = await import("./engagement");

    expect(statsReportHref({ group: "episode", kind: "revenue" }, week)).toBe(
      "/analytics/revenue?from=2025-03-03&group=episode&to=2025-03-09"
    );
    expect(statsReportHref(dropOff, week)).toBe(
      "/analytics/episodes/SER001/EP001?from=2025-03-03&to=2025-03-09"
    );
  });
});
