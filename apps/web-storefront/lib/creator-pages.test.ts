import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import {
  ClientSurface,
  CreatorStatementLineSource,
} from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { tenantCreatorCommentsTag, tenantCreatorPagesTag } from "./cache-tags";
import {
  getMyCreatorStatement,
  getMyCreatorStatementExport,
  getMyCreatorStats,
  listMyCreatorComments,
  listMyCreators,
} from "./creator-pages";

const {
  mockCacheTag,
  mockGetMyCreatorStatement,
  mockGetMyCreatorStats,
  mockListMyCreatorEpisodeComments,
  mockListMyCreators,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetMyCreatorStatement: vi.fn(),
  mockGetMyCreatorStats: vi.fn(),
  mockListMyCreatorEpisodeComments: vi.fn(),
  mockListMyCreators: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    creator: {
      getMyCreatorStatement: mockGetMyCreatorStatement,
      getMyCreatorStats: mockGetMyCreatorStats,
      listMyCreatorEpisodeComments: mockListMyCreatorEpisodeComments,
      listMyCreators: mockListMyCreators,
    },
  },
  buildSessionHeaders: (accessToken: string) => ({
    Authorization: `Bearer ${accessToken}`,
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREATOR_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SESSION = { Authorization: "Bearer session-token" };

const refusedWith = (reason: string) =>
  new ConnectError("refused", Code.FailedPrecondition, undefined, [
    { desc: ErrorInfoSchema, value: { domain: "publira", reason } },
  ]);

const creator = {
  iconImageUrl: " https://cdn.example.test/icon.png ",
  id: CREATOR_ID,
  name: "Night Author",
  publicId: "AUTHOR000001",
};

const statement = {
  closedAt: "2026-01-05T10:00:00Z",
  currency: "JPY",
  grossAmount: 4000n,
  payoutAmount: 1200n,
  period: "2025-12",
  refundedAmount: 0n,
  saleCount: 8n,
  timeZone: "UTC",
};

const line = (lineNumber: number, overrides = {}) => ({
  adjustedPeriod: "",
  episodePublicId: "EPISODE00001",
  episodeTitle: "The Harbor",
  grossAmount: 4000n,
  lineNumber,
  payoutAmount: 1200n,
  refundedAmount: 0n,
  roleName: "Artist",
  saleCount: 8,
  seriesPublicId: "SERIES000001",
  seriesTitle: "Night Ferry",
  shareBps: 3000,
  source: CreatorStatementLineSource.SALE,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveAccessToken.mockResolvedValue("session-token");
});

describe("listMyCreators", () => {
  it("reads the account's Authors with the session, filed under the Author pages tag", async () => {
    mockListMyCreators.mockResolvedValue({
      creators: [creator],
      salesVisible: true,
    });

    const result = await listMyCreators(TENANT_ID, "en");

    expect(mockListMyCreators).toHaveBeenCalledWith(
      { surface: ClientSurface.WEB, tenant: { tenantId: TENANT_ID } },
      SESSION
    );
    expect(mockCacheTag).toHaveBeenCalledWith(tenantCreatorPagesTag(TENANT_ID));
    expect(result).toEqual({
      ok: true,
      value: {
        creators: [
          {
            iconImageUrl: "https://cdn.example.test/icon.png",
            id: CREATOR_ID,
            name: "Night Author",
            publicId: "AUTHOR000001",
          },
        ],
        salesVisible: true,
      },
    });
  });

  it("answers missing while the tenant shows no Author pages", async () => {
    mockListMyCreators.mockRejectedValue(refusedWith("CREATOR_PAGES_DISABLED"));

    await expect(listMyCreators(TENANT_ID, "en")).resolves.toEqual({
      missing: true,
      ok: false,
    });
  });

  it("asks a reader with no session to sign in without calling the API", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    const result = await listMyCreators(TENANT_ID, "en");

    expect(mockListMyCreators).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
  });

  it("reports a rejected session as one to sign in again", async () => {
    mockListMyCreators.mockRejectedValue(
      new ConnectError("expired", Code.Unauthenticated)
    );

    await expect(listMyCreators(TENANT_ID, "en")).resolves.toMatchObject({
      missing: false,
      ok: false,
      requiresSignIn: true,
    });
  });

  it("throws a failure nothing classifies, for the section's boundary", async () => {
    mockListMyCreators.mockRejectedValue(new Error("socket hang up"));

    await expect(listMyCreators(TENANT_ID, "en")).rejects.toThrow();
  });
});

describe("getMyCreatorStats", () => {
  it("reads one page of the Author's episodes with their counts", async () => {
    mockGetMyCreatorStats.mockResolvedValue({
      currency: "JPY",
      episodes: [
        {
          completeCount: 3n,
          episodePublicId: "EPISODE00001",
          episodeTitle: "The Harbor",
          memberViewCount: 4n,
          netAmount: undefined,
          purchaseCount: undefined,
          seriesPublicId: "SERIES000001",
          seriesTitle: "Night Ferry",
        },
      ],
      followerCount: 12n,
      nextToken: "NEXT",
      periodEnd: "2026-10-31",
      periodStart: "2026-10-04",
      previousToken: "",
      timeZone: "UTC",
      totalCompleteCount: 3n,
      totalMemberViewCount: 4n,
    });

    const result = await getMyCreatorStats(TENANT_ID, {
      creatorId: CREATOR_ID,
      locale: "ja",
      token: "CURRENT",
    });

    expect(mockGetMyCreatorStats).toHaveBeenCalledWith(
      {
        creatorId: CREATOR_ID,
        limit: 20,
        locale: "ja",
        surface: ClientSurface.WEB,
        tenant: { tenantId: TENANT_ID },
        token: "CURRENT",
      },
      SESSION
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        episodes: [
          {
            completeCount: 3n,
            memberViewCount: 4n,
            netAmount: undefined,
            purchaseCount: undefined,
          },
        ],
        followerCount: 12n,
        nextToken: "NEXT",
        totalCompleteCount: 3n,
        totalMemberViewCount: 4n,
      },
    });
  });

  it("answers missing for an Author the account is not linked to", async () => {
    mockGetMyCreatorStats.mockRejectedValue(
      new ConnectError("creator not found", Code.NotFound)
    );

    await expect(
      getMyCreatorStats(TENANT_ID, {
        creatorId: CREATOR_ID,
        locale: "en",
        token: "",
      })
    ).resolves.toEqual({ missing: true, ok: false });
  });
});

describe("listMyCreatorComments", () => {
  it("reads one page of the comments with their episodes, filed under both tags", async () => {
    mockListMyCreatorEpisodeComments.mockResolvedValue({
      comments: [
        {
          comment: {
            authorIconImageVariants: [],
            authorName: "Night Reader",
            authorPublicId: "READER000001",
            body: "The last page got me.",
            createdAt: "2026-10-30T12:00:00Z",
            creator: { name: "Night Author", publicId: "AUTHOR000001" },
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          },
          episodePublicId: "EPISODE00001",
          episodeTitle: "The Harbor",
          seriesPublicId: "SERIES000001",
          seriesTitle: "Night Ferry",
        },
        {
          comment: undefined,
          episodePublicId: "EPISODE00002",
          episodeTitle: "The Lighthouse",
          seriesPublicId: "SERIES000001",
          seriesTitle: "Night Ferry",
        },
      ],
      nextToken: "NEXT",
      previousToken: "",
    });

    const result = await listMyCreatorComments(TENANT_ID, {
      creatorId: CREATOR_ID,
      locale: "ja",
      token: "CURRENT",
    });

    expect(mockListMyCreatorEpisodeComments).toHaveBeenCalledWith(
      {
        creatorId: CREATOR_ID,
        limit: 20,
        locale: "ja",
        surface: ClientSurface.WEB,
        tenant: { tenantId: TENANT_ID },
        token: "CURRENT",
      },
      SESSION
    );
    expect(mockCacheTag).toHaveBeenCalledWith(tenantCreatorPagesTag(TENANT_ID));
    expect(mockCacheTag).toHaveBeenCalledWith(
      tenantCreatorCommentsTag(TENANT_ID)
    );
    expect(result).toEqual({
      ok: true,
      value: {
        comments: [
          {
            comment: {
              authorIcon: null,
              authorName: "Night Reader",
              authorPublicId: "READER000001",
              awaitingApproval: false,
              body: "The last page got me.",
              createdAt: "2026-10-30T12:00:00Z",
              creatorName: "Night Author",
              creatorPublicId: "AUTHOR000001",
              id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            },
            episodePublicId: "EPISODE00001",
            episodeTitle: "The Harbor",
            seriesPublicId: "SERIES000001",
            seriesTitle: "Night Ferry",
          },
        ],
        nextToken: "NEXT",
        previousToken: "",
      },
    });
  });

  it("answers missing while the tenant shows no Author pages", async () => {
    mockListMyCreatorEpisodeComments.mockRejectedValue(
      refusedWith("CREATOR_PAGES_DISABLED")
    );

    await expect(
      listMyCreatorComments(TENANT_ID, {
        creatorId: CREATOR_ID,
        locale: "en",
        token: "",
      })
    ).resolves.toEqual({ missing: true, ok: false });
  });

  it("answers missing for an Author the account is not linked to", async () => {
    mockListMyCreatorEpisodeComments.mockRejectedValue(
      new ConnectError("creator not found", Code.NotFound)
    );

    await expect(
      listMyCreatorComments(TENANT_ID, {
        creatorId: CREATOR_ID,
        locale: "en",
        token: "",
      })
    ).resolves.toEqual({ missing: true, ok: false });
  });

  it("reports a read the API failed, for the page to show", async () => {
    mockListMyCreatorEpisodeComments.mockRejectedValue(
      new ConnectError("down", Code.Unavailable)
    );

    await expect(
      listMyCreatorComments(TENANT_ID, {
        creatorId: CREATOR_ID,
        locale: "en",
        token: "",
      })
    ).resolves.toMatchObject({
      missing: false,
      ok: false,
      requiresSignIn: false,
    });
  });
});

describe("getMyCreatorStatement", () => {
  it("maps the Author's lines, a line of tips, a subscription line, and an adjustment among them", async () => {
    mockGetMyCreatorStatement.mockResolvedValue({
      lines: [
        line(1),
        line(2, { source: CreatorStatementLineSource.TIP }),
        line(4, { source: CreatorStatementLineSource.SUBSCRIPTION }),
        line(9, {
          adjustedPeriod: "2025-11",
          grossAmount: -500n,
          payoutAmount: -150n,
          refundedAmount: -500n,
          saleCount: -1,
        }),
      ],
      nextToken: "",
      previousToken: "",
      statement,
    });

    const result = await getMyCreatorStatement(TENANT_ID, {
      creatorId: CREATOR_ID,
      locale: "en",
      period: "2025-12",
      token: "",
    });

    expect(result.ok && result.value.statement).toEqual({
      closedAt: "2026-01-05T10:00:00Z",
      currency: "JPY",
      grossAmount: 4000n,
      payoutAmount: 1200n,
      period: "2025-12",
      refundedAmount: 0n,
      saleCount: 8n,
      timeZone: "UTC",
    });
    expect(
      result.ok &&
        result.value.lines.map(({ adjustedPeriod, payoutAmount, source }) => ({
          adjustedPeriod,
          payoutAmount,
          source,
        }))
    ).toEqual([
      { adjustedPeriod: "", payoutAmount: 1200n, source: "sale" },
      { adjustedPeriod: "", payoutAmount: 1200n, source: "tip" },
      { adjustedPeriod: "", payoutAmount: 1200n, source: "subscription" },
      { adjustedPeriod: "2025-11", payoutAmount: -150n, source: "sale" },
    ]);
  });

  it("answers missing while the tenant hides its Authors' sales", async () => {
    mockGetMyCreatorStatement.mockRejectedValue(
      refusedWith("CREATOR_SALES_HIDDEN")
    );

    await expect(
      getMyCreatorStatement(TENANT_ID, {
        creatorId: CREATOR_ID,
        locale: "en",
        period: "2025-12",
        token: "",
      })
    ).resolves.toEqual({ missing: true, ok: false });
  });
});

describe("getMyCreatorStatementExport", () => {
  it("reads every page of the month's lines and names the Author they credit", async () => {
    mockListMyCreators.mockResolvedValue({
      creators: [creator],
      salesVisible: true,
    });
    mockGetMyCreatorStatement
      .mockResolvedValueOnce({
        lines: [line(1), line(2)],
        nextToken: "NEXT",
        previousToken: "",
        statement,
      })
      .mockResolvedValueOnce({
        lines: [line(5)],
        nextToken: "",
        previousToken: "PREV",
        statement,
      });

    const result = await getMyCreatorStatementExport(
      TENANT_ID,
      "session-token",
      { creatorId: CREATOR_ID, period: "2025-12" }
    );

    expect(mockGetMyCreatorStatement).toHaveBeenNthCalledWith(
      1,
      {
        creatorId: CREATOR_ID,
        limit: 100,
        period: "2025-12",
        surface: ClientSurface.WEB,
        tenant: { tenantId: TENANT_ID },
        token: "",
      },
      SESSION
    );
    expect(mockGetMyCreatorStatement).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ token: "NEXT" }),
      SESSION
    );
    expect(result?.creator.publicId).toBe("AUTHOR000001");
    expect(result?.lines.map(({ lineNumber }) => lineNumber)).toEqual([
      1, 2, 5,
    ]);
  });

  it("answers null for a month that is not closed", async () => {
    mockListMyCreators.mockResolvedValue({
      creators: [creator],
      salesVisible: true,
    });
    mockGetMyCreatorStatement.mockRejectedValue(
      new ConnectError("royalty statement not found", Code.NotFound)
    );

    await expect(
      getMyCreatorStatementExport(TENANT_ID, "session-token", {
        creatorId: CREATOR_ID,
        period: "2026-10",
      })
    ).resolves.toBeNull();
  });

  it("throws a rejected session for the caller to send the reader to sign in", async () => {
    mockListMyCreators.mockRejectedValue(
      new ConnectError("expired", Code.Unauthenticated)
    );
    mockGetMyCreatorStatement.mockResolvedValue({
      lines: [],
      nextToken: "",
      previousToken: "",
      statement,
    });

    await expect(
      getMyCreatorStatementExport(TENANT_ID, "session-token", {
        creatorId: CREATOR_ID,
        period: "2025-12",
      })
    ).rejects.toMatchObject({ code: Code.Unauthenticated });
  });
});
