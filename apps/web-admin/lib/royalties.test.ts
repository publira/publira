import { RoyaltyCloseMode } from "@publira/api-client/admin/royalty";
import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApi, mockGetSessionId } = vi.hoisted(() => ({
  mockApi: {
    closeRoyaltyStatement: vi.fn(),
    exportRoyaltyStatement: vi.fn(),
    getRoyaltyConfig: vi.fn(),
    getRoyaltyStatement: vi.fn(),
    listRoyaltyStatements: vi.fn(),
    previewRoyaltyStatement: vi.fn(),
  },
  mockGetSessionId: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetSessionId,
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => ({ royalties: mockApi }),
}));

// Amounts are int64, so the wire value is a `bigint` and the mapper narrows it.
const wireLine = {
  creatorName: "Aki",
  creatorPublicId: "CR001",
  episodePublicId: "EP001",
  episodeTitle: "Episode 1",
  grossAmount: 5000n,
  lineNumber: 1,
  payoutAmount: 1500n,
  refundedAmount: 0n,
  roleName: "Artist",
  rolePublicId: "RL001",
  saleCount: 10,
  seriesPublicId: "SR001",
  seriesTitle: "Series A",
  shareBps: 3000,
};

const mappedLine = {
  creatorName: "Aki",
  creatorPublicId: "CR001",
  episodeTitle: "Episode 1",
  grossAmount: 5000,
  lineNumber: 1,
  payoutAmount: 1500,
  refundedAmount: 0,
  roleName: "Artist",
  saleCount: 10,
  seriesTitle: "Series A",
  shareBps: 3000,
};

const wireTotals = {
  gross: 5000n,
  payout: 1500n,
  refunded: 0n,
};

describe("royalties", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
  });

  it("reads an automatic close policy with its day", async () => {
    mockApi.getRoyaltyConfig.mockResolvedValueOnce({
      config: {
        autoCloseDay: 5,
        automaticSince: "2026-08-15T00:00:00Z",
        closeMode: RoyaltyCloseMode.AUTOMATIC,
      },
    });
    const { getRoyaltyClosePolicy } = await import("./royalties");

    expect(await getRoyaltyClosePolicy("TENANT001", "en")).toEqual({
      ok: true,
      policy: {
        autoCloseDay: 5,
        automaticSince: "2026-08-15T00:00:00Z",
        closeMode: "automatic",
      },
    });
  });

  it("reads a tenant that never chose as manual", async () => {
    mockApi.getRoyaltyConfig.mockResolvedValueOnce({
      config: {
        automaticSince: "",
        closeMode: RoyaltyCloseMode.MANUAL,
      },
    });
    const { getRoyaltyClosePolicy } = await import("./royalties");

    expect(await getRoyaltyClosePolicy("TENANT001", "en")).toEqual({
      ok: true,
      policy: { automaticSince: "", closeMode: "manual" },
    });
  });

  it("maps a preview's lines and totals", async () => {
    mockApi.previewRoyaltyStatement.mockResolvedValueOnce({
      lines: [wireLine],
      period: "2026-08",
      timeZone: "Asia/Tokyo",
      totals: wireTotals,
    });
    const { previewRoyaltyStatement } = await import("./royalties");

    expect(await previewRoyaltyStatement("TENANT001", "en", "2026-08")).toEqual(
      {
        lines: [mappedLine],
        ok: true,
        period: "2026-08",
        timeZone: "Asia/Tokyo",
        totals: { gross: 5000, payout: 1500, refunded: 0 },
      }
    );
    expect(mockApi.previewRoyaltyStatement).toHaveBeenCalledWith(
      { period: "2026-08", tenant: { tenantId: "TENANT001" } },
      expect.anything()
    );
  });

  it("tells a month that cannot be previewed from a failed read", async () => {
    mockApi.previewRoyaltyStatement.mockRejectedValueOnce(
      new ConnectError("already closed", Code.FailedPrecondition)
    );
    mockApi.previewRoyaltyStatement.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );
    const { previewRoyaltyStatement } = await import("./royalties");

    const closed = await previewRoyaltyStatement("TENANT001", "en", "2026-07");
    const down = await previewRoyaltyStatement("TENANT001", "en", "2026-07");

    expect(closed).toMatchObject({ notOpen: true, ok: false });
    expect(down).toMatchObject({ notOpen: false, ok: false });
  });

  it("reports a statement that is not closed as not found", async () => {
    mockApi.getRoyaltyStatement.mockRejectedValueOnce(
      new ConnectError("royalty statement not found", Code.NotFound)
    );
    const { getRoyaltyStatement } = await import("./royalties");

    expect(
      await getRoyaltyStatement("TENANT001", "en", "2026-09")
    ).toMatchObject({ notFound: true, ok: false });
  });

  it("maps a statement page with its paging tokens", async () => {
    mockApi.getRoyaltyStatement.mockResolvedValueOnce({
      lines: [wireLine],
      nextToken: "next",
      previousToken: "",
      statement: {
        closedAt: "2026-09-02T01:30:00Z",
        closedByUserName: "Operator",
        closedByUserPublicId: "US001",
        period: "2026-08",
        timeZone: "Asia/Tokyo",
        totals: wireTotals,
      },
    });
    const { getRoyaltyStatement } = await import("./royalties");

    expect(
      await getRoyaltyStatement("TENANT001", "en", "2026-08", {
        limit: 20,
        token: "cursor",
      })
    ).toEqual({
      lines: [mappedLine],
      nextToken: "next",
      ok: true,
      previousToken: "",
      statement: {
        closedAt: "2026-09-02T01:30:00Z",
        closedByUserName: "Operator",
        period: "2026-08",
        timeZone: "Asia/Tokyo",
        totals: { gross: 5000, payout: 1500, refunded: 0 },
      },
    });
    expect(mockApi.getRoyaltyStatement).toHaveBeenCalledWith(
      {
        limit: 20,
        period: "2026-08",
        tenant: { tenantId: "TENANT001" },
        token: "cursor",
      },
      expect.anything()
    );
  });

  it("words a second close of the same month as already closed", async () => {
    mockApi.closeRoyaltyStatement.mockRejectedValueOnce(
      new ConnectError("the month is already closed", Code.AlreadyExists)
    );
    const { closeRoyaltyStatement } = await import("./royalties");

    expect(
      await closeRoyaltyStatement(
        { period: "2026-08", tenantId: "TENANT001" },
        "en"
      )
    ).toEqual({ message: "This month is already closed.", ok: false });
  });

  it("words a close of a running month as not over", async () => {
    mockApi.closeRoyaltyStatement.mockRejectedValueOnce(
      new ConnectError("the month is not over yet", Code.FailedPrecondition)
    );
    const { closeRoyaltyStatement } = await import("./royalties");

    expect(
      await closeRoyaltyStatement(
        { period: "2026-09", tenantId: "TENANT001" },
        "en"
      )
    ).toEqual({
      message: "This month is not over yet, so it cannot be closed.",
      ok: false,
    });
  });

  it("exports a closed month with the operator's session", async () => {
    const csv = new TextEncoder().encode("period,creator_id\r\n");
    mockApi.exportRoyaltyStatement.mockResolvedValueOnce({ csv });
    const { exportRoyaltyStatement } = await import("./royalties");

    const result = await exportRoyaltyStatement("TENANT001", "2026-08");

    expect(result).toEqual({ csv, ok: true });
    expect(mockApi.exportRoyaltyStatement).toHaveBeenCalledWith(
      { period: "2026-08", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("reports a month that is not closed as missing", async () => {
    mockApi.exportRoyaltyStatement.mockRejectedValueOnce(
      new ConnectError("the month is not closed", Code.FailedPrecondition)
    );
    const { exportRoyaltyStatement } = await import("./royalties");

    expect(await exportRoyaltyStatement("TENANT001", "2026-09")).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("reports a rejected session as signed out", async () => {
    mockApi.exportRoyaltyStatement.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );
    const { exportRoyaltyStatement } = await import("./royalties");

    expect(await exportRoyaltyStatement("TENANT001", "2026-08")).toEqual({
      ok: false,
      reason: "signedOut",
    });
  });

  it("exports nothing without a session", async () => {
    mockGetSessionId.mockResolvedValueOnce("");
    const { exportRoyaltyStatement } = await import("./royalties");

    expect(await exportRoyaltyStatement("TENANT001", "2026-08")).toEqual({
      ok: false,
      reason: "signedOut",
    });
    expect(mockApi.exportRoyaltyStatement).not.toHaveBeenCalled();
  });

  it("lets an outage fail the download", async () => {
    mockApi.exportRoyaltyStatement.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable)
    );
    const { exportRoyaltyStatement } = await import("./royalties");

    await expect(
      exportRoyaltyStatement("TENANT001", "2026-08")
    ).rejects.toThrow();
  });
});
