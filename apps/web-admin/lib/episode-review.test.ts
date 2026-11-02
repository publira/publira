import { EpisodeReviewState } from "@publira/api-client/admin/types";
import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockApproveEpisodeApi,
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockListEpisodeReviewsApi,
  mockReturnEpisodeApi,
  mockSubmitEpisodeForReviewApi,
} = vi.hoisted(() => ({
  mockApproveEpisodeApi: vi.fn(),
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockListEpisodeReviewsApi: vi.fn(),
  mockReturnEpisodeApi: vi.fn(),
  mockSubmitEpisodeForReviewApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./episode", () => ({
  episodeCacheTag: (tenantId: string, episodeId: string) =>
    `episode-${tenantId}-${episodeId}`,
  episodesCacheTag: (tenantId: string) => `episodes-${tenantId}`,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    series: {
      approveEpisode: mockApproveEpisodeApi,
      listEpisodeReviews: mockListEpisodeReviewsApi,
      returnEpisode: mockReturnEpisodeApi,
      submitEpisodeForReview: mockSubmitEpisodeForReviewApi,
    },
  },
  withServiceHeaders: () => ({}),
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const target = { episodeId: "EPISODE001-ID", tenantId: "TENANT001" };

describe("episode-review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  describe("listEpisodeReviews", () => {
    it("lists the rounds in the order the API gives, under the episode tags", async () => {
      mockListEpisodeReviewsApi.mockResolvedValueOnce({
        rounds: [
          {
            comment: "Fix page 3.",
            decidedAt: "2026-11-02T10:00:00Z",
            decidedByName: "Admin",
            id: "ROUND1",
            state: EpisodeReviewState.RETURNED,
            submittedAt: "2026-11-01T10:00:00Z",
            submittedByName: "Editor",
          },
          {
            comment: "",
            decidedAt: "",
            decidedByName: "",
            id: "ROUND2",
            state: EpisodeReviewState.IN_REVIEW,
            submittedAt: "2026-11-03T10:00:00Z",
            submittedByName: "",
          },
        ],
      });

      const { listEpisodeReviews } = await import("./episode-review");

      const result = await listEpisodeReviews(target, "en");

      expect(result).toEqual({
        ok: true,
        rounds: [
          {
            comment: "Fix page 3.",
            decidedAt: "2026-11-02T10:00:00Z",
            decidedByName: "Admin",
            id: "ROUND1",
            state: "returned",
            submittedAt: "2026-11-01T10:00:00Z",
            submittedByName: "Editor",
          },
          {
            comment: "",
            decidedAt: "",
            decidedByName: "",
            id: "ROUND2",
            state: "in_review",
            submittedAt: "2026-11-03T10:00:00Z",
            submittedByName: "",
          },
        ],
      });
      expect(mockListEpisodeReviewsApi).toHaveBeenCalledWith(
        { episodeId: "EPISODE001-ID", tenant: { tenantId: "TENANT001" } },
        { headers: { Authorization: "Bearer session-token" } }
      );
      // Every episode write can open a round, and every one clears these.
      expect(mockCacheTag).toHaveBeenCalledWith("episodes-TENANT001");
      expect(mockCacheTag).toHaveBeenCalledWith(
        "episode-TENANT001-EPISODE001-ID"
      );
    });

    it("leaves out a round in a state this build does not know", async () => {
      mockListEpisodeReviewsApi.mockResolvedValueOnce({
        rounds: [
          {
            id: "ROUND1",
            // SAFETY: a value no member of the enum holds, which is what a
            // newer server's state reads as on this build.
            state: 99 as EpisodeReviewState,
            submittedAt: "2026-11-01T10:00:00Z",
          },
        ],
      });

      const { listEpisodeReviews } = await import("./episode-review");

      expect(await listEpisodeReviews(target, "en")).toEqual({
        ok: true,
        rounds: [],
      });
    });

    it("reports a rejected session for the page to send to sign-in", async () => {
      mockListEpisodeReviewsApi.mockRejectedValueOnce(
        new ConnectError("expired", Code.Unauthenticated)
      );

      const { listEpisodeReviews } = await import("./episode-review");

      const result = await listEpisodeReviews(target, "en");

      expect(result).toMatchObject({ ok: false, requiresSignIn: true });
      expect(mockCacheLife).toHaveBeenCalledWith({
        expire: 0,
        revalidate: 0,
        stale: 0,
      });
    });
  });

  describe("the review writes", () => {
    it("submits the episode with the operator's session", async () => {
      mockSubmitEpisodeForReviewApi.mockResolvedValueOnce({});

      const { submitEpisodeForReview } = await import("./episode-review");

      expect(await submitEpisodeForReview(target, "en")).toEqual({ ok: true });
      expect(mockSubmitEpisodeForReviewApi).toHaveBeenCalledWith(
        { episodeId: "EPISODE001-ID", tenant: { tenantId: "TENANT001" } },
        { headers: { Authorization: "Bearer session-token" } }
      );
    });

    it("approves with the comment", async () => {
      mockApproveEpisodeApi.mockResolvedValueOnce({});

      const { approveEpisode } = await import("./episode-review");

      await approveEpisode({ ...target, comment: "Good." }, "en");

      expect(mockApproveEpisodeApi).toHaveBeenCalledWith(
        {
          comment: "Good.",
          episodeId: "EPISODE001-ID",
          tenant: { tenantId: "TENANT001" },
        },
        { headers: { Authorization: "Bearer session-token" } }
      );
    });

    it("returns with the comment", async () => {
      mockReturnEpisodeApi.mockResolvedValueOnce({});

      const { returnEpisode } = await import("./episode-review");

      await returnEpisode({ ...target, comment: "Fix it." }, "en");

      expect(mockReturnEpisodeApi).toHaveBeenCalledWith(
        {
          comment: "Fix it.",
          episodeId: "EPISODE001-ID",
          tenant: { tenantId: "TENANT001" },
        },
        { headers: { Authorization: "Bearer session-token" } }
      );
    });

    it("says to reload when the episode moved on since the screen was read", async () => {
      mockApproveEpisodeApi.mockRejectedValueOnce(
        new ConnectError("not in review", Code.FailedPrecondition)
      );

      const { approveEpisode } = await import("./episode-review");

      expect(await approveEpisode({ ...target, comment: "" }, "en")).toEqual({
        message:
          "This episode's review has changed since the page was loaded. Reload the page to see where it stands.",
        ok: false,
      });
    });

    it("refuses to write without a session", async () => {
      mockGetAccessToken.mockResolvedValue("");

      const { returnEpisode } = await import("./episode-review");

      const result = await returnEpisode({ ...target, comment: "x" }, "en");

      expect(result.ok).toBe(false);
      expect(mockReturnEpisodeApi).not.toHaveBeenCalled();
    });
  });
});
