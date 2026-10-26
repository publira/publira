import { StatsExportKind } from "@publira/api-client/admin/engagement";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApi, mockGetAccessToken } = vi.hoisted(() => ({
  mockApi: {
    auth: { getTenant: vi.fn() },
    engagement: { exportStats: vi.fn() },
  },
  mockGetAccessToken: vi.fn(),
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

const { GET } = await import("./route");

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION = { headers: { Authorization: "Bearer session-token" } };

const download = (query: string) =>
  GET(
    new Request(
      `https://admin.example.test/api/v1/analytics/audience/csv${query}`
    ),
    { params: Promise.resolve({ tenant_id: TENANT_ID }) }
  );

describe("GET /api/v1/analytics/audience/csv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue("session-token");
    mockApi.auth.getTenant.mockResolvedValue({
      tenant: { name: "Analytics Press", publicId: "AnlyTNNTAAA1" },
    });
    mockApi.engagement.exportStats.mockResolvedValue({
      csv: new TextEncoder().encode("﻿date\r\n"),
    });
  });

  it("saves the breakdown by series under the tenant and period", async () => {
    const response = await download(
      "?from=2025-03-03&to=2025-03-09&group=series"
    );

    expect(mockApi.engagement.exportStats).toHaveBeenCalledWith(
      {
        endDate: "2025-03-09",
        kind: StatsExportKind.AUDIENCE_BY_SERIES,
        startDate: "2025-03-03",
        tenant: { tenantId: TENANT_ID },
      },
      SESSION
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="audience-by-series-AnlyTNNTAAA1-2025-03-03--2025-03-09.csv"'
    );
  });

  it("writes the breakdown by day for a group Audience does not have", async () => {
    await download("?from=2025-03-03&to=2025-03-09&group=episode");

    expect(mockApi.engagement.exportStats).toHaveBeenCalledWith(
      expect.objectContaining({ kind: StatsExportKind.AUDIENCE_BY_DAY }),
      SESSION
    );
  });
});
