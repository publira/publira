import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSessionId, mockListEpisodeReadThroughApi } = vi.hoisted(() => ({
  mockGetSessionId: vi.fn(),
  mockListEpisodeReadThroughApi: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetSessionId,
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => ({
    engagement: {
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
      period: { end: "2026-03-14", start: "2026-02-15" },
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

    expect(readThroughRate(7, 20)).toBe(0.35);
  });

  it("answers null rather than zero when nobody viewed", async () => {
    const { readThroughRate } = await import("./engagement");

    expect(readThroughRate(0, 0)).toBeNull();
  });
});
