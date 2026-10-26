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
const SESSION = { headers: { Authorization: "Bearer session-token" } };

const download = (query = "?from=2025-03-03&to=2025-03-09") =>
  GET(
    new Request(
      `https://admin.example.test/api/v1/analytics/episodes/SER001/EP001/csv${query}`
    ),
    {
      params: Promise.resolve({
        episode_id: "EP001",
        series_id: "SER001",
        tenant_id: TENANT_ID,
      }),
    }
  );

describe("GET /api/v1/analytics/episodes/[series_id]/[episode_id]/csv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue("session-token");
    mockApi.auth.getTenant.mockResolvedValue({
      tenant: { name: "Analytics Press", publicId: "AnlyTNNTAAA1" },
    });
    mockApi.engagement.exportStats.mockResolvedValue({
      csv: new TextEncoder().encode("﻿start_date\r\n"),
    });
  });

  it("saves the episode's drop-off under the tenant, the episode, and the period", async () => {
    const response = await download();

    expect(mockApi.engagement.exportStats).toHaveBeenCalledWith(
      {
        endDate: "2025-03-09",
        episodePublicId: "EP001",
        kind: StatsExportKind.EPISODE_DROP_OFF,
        startDate: "2025-03-03",
        tenant: { tenantId: TENANT_ID },
      },
      SESSION
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="drop-off-AnlyTNNTAAA1-EP001-2025-03-03--2025-03-09.csv"'
    );
  });

  it("answers not found for an episode the tenant does not have", async () => {
    mockApi.engagement.exportStats.mockRejectedValueOnce(
      new ConnectError("no such episode", Code.NotFound)
    );

    const response = await download();

    expect(response.status).toBe(404);
  });

  it("sends a rejected session to login and back to the episode's drop-off", async () => {
    mockApi.engagement.exportStats.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    await expect(download()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith(
      `/login?${new URLSearchParams({
        next: "/analytics/episodes/SER001/EP001?from=2025-03-03&to=2025-03-09",
        reason: "session_revoked",
      })}`
    );
  });
});
