import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockApproveComment,
  mockCountPendingComments,
  mockGetAccessToken,
  mockHideComment,
  mockListCommentReports,
  mockListComments,
  mockPurgeComment,
  mockResolveCommentReport,
  mockRestoreComment,
} = vi.hoisted(() => ({
  mockApproveComment: vi.fn(),
  mockCountPendingComments: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockHideComment: vi.fn(),
  mockListCommentReports: vi.fn(),
  mockListComments: vi.fn(),
  mockPurgeComment: vi.fn(),
  mockResolveCommentReport: vi.fn(),
  mockRestoreComment: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    comments: {
      approveComment: mockApproveComment,
      countPendingComments: mockCountPendingComments,
      hideComment: mockHideComment,
      listCommentReports: mockListCommentReports,
      listComments: mockListComments,
      purgeComment: mockPurgeComment,
      resolveCommentReport: mockResolveCommentReport,
      restoreComment: mockRestoreComment,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const adminComment = {
  authorName: "Reader",
  authorPublicId: "USER001",
  body: "A comment on the first episode.",
  createdAt: "2026-06-01T00:00:00Z",
  episodePublicId: "EPISODE001",
  episodeTitle: "Episode 1",
  hiddenAt: "2026-06-02T00:00:00Z",
  hiddenReason: "staff",
  openReportCount: 2,
  publicId: "COMMENT0001",
  publishedAt: "2026-06-01T01:00:00Z",
  purgeDueAt: "",
  seriesPublicId: "SERIES001",
  seriesTitle: "Series A",
  status: "hidden",
  withdrawnAt: "",
};

const commentReport = {
  comment: adminComment,
  createdAt: "2026-06-03T00:00:00Z",
  note: "Nothing to do with the episode.",
  reason: "spam",
  reportId: "018f0f80-0001-7000-8000-000000000001",
  reporterName: "Another Reader",
  reporterPublicId: "USER002",
  resolvedAt: "",
  status: "open",
};

const mappedComment = {
  authorName: "Reader",
  authorPublicId: "USER001",
  body: "A comment on the first episode.",
  createdAt: "2026-06-01T00:00:00Z",
  episodePublicId: "EPISODE001",
  episodeTitle: "Episode 1",
  hiddenAt: "2026-06-02T00:00:00Z",
  hiddenReason: "staff",
  openReportCount: 2,
  publicId: "COMMENT0001",
  publishedAt: "2026-06-01T01:00:00Z",
  purgeDueAt: "",
  seriesPublicId: "SERIES001",
  seriesTitle: "Series A",
  status: "hidden",
  withdrawnAt: "",
};

describe("comment lib", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("passes the filters and the cursor through and maps one page of rows", async () => {
    mockListComments.mockResolvedValue({
      comments: [adminComment],
      nextToken: "next-token",
      previousToken: "",
    });

    const { listComments } = await import("./comment");
    const result = await listComments("TENANT001", "en", {
      episodePublicId: " EPISODE001 ",
      limit: 10,
      seriesPublicId: " SERIES001 ",
      status: "hidden",
      // The screen's own parser has already trimmed the cursor; only the
      // filters an operator typed reach the RPC needing it.
      token: "current-token",
    });

    expect(mockListComments).toHaveBeenCalledWith(
      {
        episodePublicId: "EPISODE001",
        limit: 10,
        seriesPublicId: "SERIES001",
        status: "hidden",
        tenant: { tenantId: "TENANT001" },
        token: "current-token",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      comments: [mappedComment],
      nextToken: "next-token",
      ok: true,
      previousToken: "",
    });
  });

  it("reads a state this build does not know as one still awaiting a decision", async () => {
    mockListComments.mockResolvedValue({
      comments: [
        { ...adminComment, hiddenReason: "escalation", status: "quarantined" },
      ],
    });

    const { listComments } = await import("./comment");
    const result = await listComments("TENANT001", "en");

    expect(result.comments[0]?.status).toBe("pending");
    expect(result.comments[0]?.hiddenReason).toBe("unknown");
  });

  it("reports a rejected session as a value so the page can raise the redirect", async () => {
    mockListComments.mockRejectedValue(
      new ConnectError("no session", Code.Unauthenticated)
    );

    const { listComments } = await import("./comment");
    const result = await listComments("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.requiresSignIn).toBe(true);
  });

  it("counts the approval queue", async () => {
    mockCountPendingComments.mockResolvedValue({ pendingCount: 3 });

    const { countPendingComments } = await import("./comment");

    expect(await countPendingComments("TENANT001", "en")).toEqual({
      ok: true,
      pendingCount: 3,
    });
  });

  it("leaves the count at zero when the API refuses it", async () => {
    mockCountPendingComments.mockRejectedValue(
      new ConnectError("forbidden", Code.PermissionDenied)
    );

    const { countPendingComments } = await import("./comment");
    const result = await countPendingComments("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result.pendingCount).toBe(0);
  });

  it("sends each action to the RPC that performs it", async () => {
    mockApproveComment.mockResolvedValue({});
    mockHideComment.mockResolvedValue({});
    mockRestoreComment.mockResolvedValue({});
    mockPurgeComment.mockResolvedValue({});

    const { moderateComment } = await import("./comment");
    const input = {
      publicId: "COMMENT0001",
      reason: "Personal information",
      tenantId: "TENANT001",
    };

    await moderateComment({ ...input, action: "approve" }, "en");
    await moderateComment({ ...input, action: "hide" }, "en");
    await moderateComment({ ...input, action: "restore" }, "en");
    await moderateComment({ ...input, action: "purge" }, "en");

    const request = {
      publicId: "COMMENT0001",
      reason: "Personal information",
      tenant: { tenantId: "TENANT001" },
    };
    const headers = { headers: { Authorization: "Bearer session-token" } };
    expect(mockApproveComment).toHaveBeenCalledWith(request, headers);
    expect(mockHideComment).toHaveBeenCalledWith(request, headers);
    expect(mockRestoreComment).toHaveBeenCalledWith(request, headers);
    expect(mockPurgeComment).toHaveBeenCalledWith(request, headers);
  });

  it("says the comment was already handled when it is no longer in that state", async () => {
    mockApproveComment.mockRejectedValue(
      new ConnectError("already moved", Code.FailedPrecondition)
    );

    const { moderateComment } = await import("./comment");
    const result = await moderateComment(
      {
        action: "approve",
        publicId: "COMMENT0001",
        reason: "",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "Another moderator already handled this comment. Reload the list to see its current state.",
      ok: false,
    });
  });

  it("lets a rejected session leave as a throw so the Action can re-authenticate", async () => {
    mockHideComment.mockRejectedValue(
      new ConnectError("no session", Code.Unauthenticated)
    );

    const { moderateComment } = await import("./comment");

    await expect(
      moderateComment(
        {
          action: "hide",
          publicId: "COMMENT0001",
          reason: "",
          tenantId: "TENANT001",
        },
        "en"
      )
    ).rejects.toThrow(ConnectError);
  });

  it("maps one page of reports with the comment each of them is about", async () => {
    mockListCommentReports.mockResolvedValue({
      nextToken: "next-token",
      previousToken: "",
      reports: [commentReport],
    });

    const { listCommentReports } = await import("./comment");
    const result = await listCommentReports("TENANT001", "en", {
      limit: 10,
      status: " open ",
      token: "current-token",
    });

    expect(mockListCommentReports).toHaveBeenCalledWith(
      {
        limit: 10,
        status: "open",
        tenant: { tenantId: "TENANT001" },
        token: "current-token",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      nextToken: "next-token",
      ok: true,
      previousToken: "",
      reports: [
        {
          comment: mappedComment,
          createdAt: "2026-06-03T00:00:00Z",
          note: "Nothing to do with the episode.",
          reason: "spam",
          reportId: "018f0f80-0001-7000-8000-000000000001",
          reporterName: "Another Reader",
          reporterPublicId: "USER002",
          resolvedAt: "",
          status: "open",
        },
      ],
    });
  });

  it("reads a report state and a reason this build does not know as work still waiting", async () => {
    mockListCommentReports.mockResolvedValue({
      reports: [{ ...commentReport, reason: "impersonation", status: "held" }],
    });

    const { listCommentReports } = await import("./comment");
    const result = await listCommentReports("TENANT001", "en");

    expect(result.reports[0]?.status).toBe("open");
    expect(result.reports[0]?.reason).toBe("unknown");
  });

  it("sends the decision and which report it is about", async () => {
    mockResolveCommentReport.mockResolvedValue({});

    const { resolveCommentReport } = await import("./comment");
    const result = await resolveCommentReport(
      {
        reason: "Advertising, as reported.",
        reportId: "018f0f80-0001-7000-8000-000000000001",
        resolution: "resolved",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockResolveCommentReport).toHaveBeenCalledWith(
      {
        reason: "Advertising, as reported.",
        reportId: "018f0f80-0001-7000-8000-000000000001",
        resolution: "resolved",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({ ok: true });
  });

  it("says the report was already decided when another moderator got there first", async () => {
    mockResolveCommentReport.mockRejectedValue(
      new ConnectError("already decided", Code.FailedPrecondition)
    );

    const { resolveCommentReport } = await import("./comment");
    const result = await resolveCommentReport(
      {
        reason: "",
        reportId: "018f0f80-0001-7000-8000-000000000001",
        resolution: "rejected",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "Another moderator already decided this report. Reload the queue to see it.",
      ok: false,
    });
  });
});
