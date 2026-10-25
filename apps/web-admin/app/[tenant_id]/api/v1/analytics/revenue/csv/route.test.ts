import { StatsExportKind } from "@publira/api-client/admin/engagement";
import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApi, mockGetAccessToken, mockRedirect } = vi.hoisted(() => ({
  mockApi: {
    auth: { getTenant: vi.fn() },
    engagement: { exportStats: vi.fn() },
  },
  mockGetAccessToken: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => mockApi,
}));

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
}));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

const { GET } = await import("./route");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const CSV = new TextEncoder().encode(
  "﻿start_date,end_date,series_id,series_title\r\n"
);
const SESSION = { headers: { Authorization: "Bearer session-token" } };

const download = (query: string, tenantId = TENANT_ID) =>
  GET(
    new Request(
      `https://admin.example.test/api/v1/analytics/revenue/csv${query}`
    ),
    { params: Promise.resolve({ tenant_id: tenantId }) }
  );

describe("GET /api/v1/analytics/revenue/csv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue("session-token");
    mockApi.auth.getTenant.mockResolvedValue({
      tenant: { name: "Analytics Press", publicId: "AnlyTNNTAAA1" },
    });
    mockApi.engagement.exportStats.mockResolvedValue({ csv: CSV });
  });

  it("forwards the session and saves the breakdown under the tenant and period", async () => {
    const response = await download(
      "?from=2025-03-03&to=2025-03-09&group=series"
    );

    expect(mockApi.engagement.exportStats).toHaveBeenCalledWith(
      {
        endDate: "2025-03-09",
        kind: StatsExportKind.REVENUE_BY_SERIES,
        startDate: "2025-03-03",
        tenant: { tenantId: TENANT_ID },
      },
      SESSION
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="revenue-by-series-AnlyTNNTAAA1-2025-03-03--2025-03-09.csv"'
    );
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(CSV);
  });

  it("writes the breakdown by day when the query names none", async () => {
    const response = await download("?from=2025-03-03&to=2025-03-09");

    expect(mockApi.engagement.exportStats).toHaveBeenCalledWith(
      expect.objectContaining({ kind: StatsExportKind.REVENUE_BY_DAY }),
      SESSION
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="revenue-by-day-AnlyTNNTAAA1-2025-03-03--2025-03-09.csv"'
    );
  });

  it.each([
    ["without an end", "?from=2025-03-03"],
    ["for a day that is not on the calendar", "?from=2025-02-30&to=2025-03-09"],
  ])("answers not found %s", async (_label, query) => {
    const response = await download(query);

    expect(response.status).toBe(404);
    expect(mockApi.engagement.exportStats).not.toHaveBeenCalled();
  });

  it("answers not found for a period the API refuses", async () => {
    mockApi.engagement.exportStats.mockRejectedValueOnce(
      new ConnectError("the period is reversed", Code.InvalidArgument)
    );

    const response = await download("?from=2025-03-09&to=2025-03-03");

    expect(response.status).toBe(404);
  });

  it("answers not found for a member below tenant admin", async () => {
    mockApi.engagement.exportStats.mockRejectedValueOnce(
      new ConnectError("tenant admin required", Code.PermissionDenied)
    );

    const response = await download("?from=2025-03-03&to=2025-03-09");

    expect(response.status).toBe(404);
  });

  it("answers not found for a tenant id the proxy would never rewrite", async () => {
    const response = await download(
      "?from=2025-03-03&to=2025-03-09",
      "not-a-tenant"
    );

    expect(response.status).toBe(404);
    expect(mockApi.engagement.exportStats).not.toHaveBeenCalled();
  });

  it("sends a rejected session to login and back to the same report", async () => {
    mockApi.engagement.exportStats.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );
    mockApi.auth.getTenant.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    await expect(
      download("?from=2025-03-03&to=2025-03-09&group=episode")
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith(
      `/login?${new URLSearchParams({
        next: "/analytics/revenue?from=2025-03-03&group=episode&to=2025-03-09",
        reason: "session_revoked",
      })}`
    );
  });
});
