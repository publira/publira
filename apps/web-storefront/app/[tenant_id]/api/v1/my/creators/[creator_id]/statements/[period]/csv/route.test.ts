import { Code, ConnectError } from "@publira/api-client/errors";
import { CreatorStatementLineSource } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetMyCreatorStatement,
  mockGetTenantDefaultLocale,
  mockGetTenantSupportedLocales,
  mockListMyCreators,
  mockRedirect,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockGetMyCreatorStatement: vi.fn(),
  mockGetTenantDefaultLocale: vi.fn(),
  mockGetTenantSupportedLocales: vi.fn(),
  mockListMyCreators: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("#lib/api-client", () => ({
  apiClient: {
    creator: {
      getMyCreatorStatement: mockGetMyCreatorStatement,
      listMyCreators: mockListMyCreators,
    },
  },
  buildSessionHeaders: (accessToken: string) => ({
    Authorization: `Bearer ${accessToken}`,
  }),
  resolveAccessToken: mockResolveAccessToken,
  sealSessionCookieValue: vi.fn(),
}));

vi.mock("#lib/tenant", () => ({
  getTenantDefaultLocale: mockGetTenantDefaultLocale,
  getTenantSupportedLocales: mockGetTenantSupportedLocales,
}));

const { GET } = await import("./route");

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREATOR_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const download = ({
  creatorId = CREATOR_ID,
  period = "2025-12",
  query = "",
} = {}) =>
  GET(
    new Request(
      `https://site.example.test/api/v1/my/creators/${creatorId}/statements/${period}/csv${query}`
    ),
    {
      params: Promise.resolve({
        creator_id: creatorId,
        period,
        tenant_id: TENANT_ID,
      }),
    }
  );

const closedMonth = {
  lines: [
    {
      adjustedPeriod: "",
      episodePublicId: "EPISODE00001",
      episodeTitle: "The Harbor",
      grossAmount: 4000n,
      lineNumber: 1,
      payoutAmount: 1200n,
      refundedAmount: 0n,
      roleName: "Artist",
      saleCount: 8,
      seriesPublicId: "SERIES000001",
      seriesTitle: "Night Ferry",
      shareBps: 3000,
      source: CreatorStatementLineSource.SALE,
    },
  ],
  nextToken: "",
  previousToken: "",
  statement: {
    closedAt: "2026-01-05T10:00:00Z",
    currency: "JPY",
    grossAmount: 4000n,
    payoutAmount: 1200n,
    period: "2025-12",
    refundedAmount: 0n,
    saleCount: 8n,
    timeZone: "UTC",
  },
};

describe("GET /api/v1/my/creators/[creator_id]/statements/[period]/csv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTenantDefaultLocale.mockResolvedValue("en");
    mockGetTenantSupportedLocales.mockResolvedValue(["en", "ja"]);
    mockResolveAccessToken.mockResolvedValue("session-token");
    mockListMyCreators.mockResolvedValue({
      creators: [
        {
          iconImageUrl: "",
          id: CREATOR_ID,
          name: "Night Author",
          publicId: "AUTHOR000001",
        },
      ],
      salesVisible: true,
    });
    mockGetMyCreatorStatement.mockResolvedValue(closedMonth);
  });

  it("answers the Author's lines as an attachment named after the Author and the month", async () => {
    const response = await download();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="royalties-AUTHOR000001-2025-12.csv"'
    );
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const csv = await response.text();
    expect(csv.split("\r\n")[1]).toBe(
      "2025-12,Artist,SERIES000001,Night Ferry,EPISODE00001,The Harbor,8,4000,0,30.00,1200,JPY,,sale"
    );
  });

  it("is not found for a path that names no Author or no month", async () => {
    const noAuthor = await download({ creatorId: "not-a-uuid" });
    const noMonth = await download({ period: "2025-13" });

    expect(noAuthor.status).toBe(404);
    expect(noMonth.status).toBe(404);
    expect(mockGetMyCreatorStatement).not.toHaveBeenCalled();
  });

  it("is not found for an Author the account is not linked to", async () => {
    mockListMyCreators.mockResolvedValue({ creators: [], salesVisible: true });

    const response = await download();

    expect(response.status).toBe(404);
  });

  it("is not found for a month that is not closed", async () => {
    mockGetMyCreatorStatement.mockRejectedValue(
      new ConnectError("royalty statement not found", Code.NotFound)
    );

    const response = await download();

    expect(response.status).toBe(404);
  });

  it("sends a reader whose session was rejected to sign in, back to the statement", async () => {
    mockListMyCreators.mockRejectedValue(
      new ConnectError("expired", Code.Unauthenticated)
    );

    await expect(download({ query: "?locale=ja" })).rejects.toThrow(
      "NEXT_REDIRECT"
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      expect.stringContaining(
        encodeURIComponent(`/my/creators/${CREATOR_ID}/statements/2025-12`)
      )
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      expect.stringMatching(/^\/ja\/login/u)
    );
  });
});
