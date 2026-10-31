import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApi, mockGetAccessToken, mockRedirect } = vi.hoisted(() => ({
  mockApi: {
    audit: { exportAuditLogs: vi.fn() },
    auth: { getTenant: vi.fn() },
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
  "﻿time,actor_public_id,actor_name,actor_role,action,outcome,reason,target_type,target_id,client_ip\r\n"
);

const SESSION = { headers: { Authorization: "Bearer session-token" } };

const download = (query: string, tenantId = TENANT_ID) =>
  GET(new Request(`https://admin.example.test/api/v1/audit-logs/csv${query}`), {
    params: Promise.resolve({ tenant_id: tenantId }),
  });

describe("GET /api/v1/audit-logs/csv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue("session-token");
    mockApi.auth.getTenant.mockResolvedValue({
      tenant: { name: "Audit Press", publicId: "AudtTNNTAAA1" },
    });
    mockApi.audit.exportAuditLogs.mockResolvedValue({ csv: CSV });
  });

  it("forwards the session and the filters, and saves the file under the tenant and period", async () => {
    const response = await download(
      "?from=2026-01-01&to=2026-01-31&action=label_created&actor=SeedADMNAAA1"
    );

    expect(mockApi.audit.exportAuditLogs).toHaveBeenCalledWith(
      {
        action: "label_created",
        actorUserPublicId: "SeedADMNAAA1",
        endDate: "2026-01-31",
        startDate: "2026-01-01",
        tenant: { tenantId: TENANT_ID },
      },
      SESSION
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="audit-log-AudtTNNTAAA1-2026-01-01--2026-01-31.csv"'
    );
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(CSV);
  });

  it("leaves the file unnarrowed when the query names no filter", async () => {
    await download("?from=2026-01-01&to=2026-01-31");

    expect(mockApi.audit.exportAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ action: "", actorUserPublicId: "" }),
      SESSION
    );
  });

  it.each([
    ["without an end", "?from=2026-01-01"],
    ["for a day that is not on the calendar", "?from=2026-02-30&to=2026-03-09"],
    ["for an empty filter", "?from=2026-01-01&to=2026-01-31&action="],
  ])("answers not found %s", async (_label, query) => {
    const response = await download(query);

    expect(response.status).toBe(404);
    expect(mockApi.audit.exportAuditLogs).not.toHaveBeenCalled();
  });

  it("answers not found for a period the API refuses", async () => {
    mockApi.audit.exportAuditLogs.mockRejectedValueOnce(
      new ConnectError("the period is too long", Code.InvalidArgument)
    );

    const response = await download("?from=2025-01-01&to=2026-01-31");

    expect(response.status).toBe(404);
  });

  it("answers not found for a member below tenant admin", async () => {
    mockApi.audit.exportAuditLogs.mockRejectedValueOnce(
      new ConnectError("tenant admin required", Code.PermissionDenied)
    );

    const response = await download("?from=2026-01-01&to=2026-01-31");

    expect(response.status).toBe(404);
  });

  it("answers not found for a tenant id the proxy would never rewrite", async () => {
    const response = await download(
      "?from=2026-01-01&to=2026-01-31",
      "not-a-tenant"
    );

    expect(response.status).toBe(404);
    expect(mockApi.audit.exportAuditLogs).not.toHaveBeenCalled();
  });

  it("sends a rejected session to login and back to the same list", async () => {
    mockApi.audit.exportAuditLogs.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );
    mockApi.auth.getTenant.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    await expect(
      download("?from=2026-01-01&to=2026-01-31&action=label_created")
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith(
      `/login?${new URLSearchParams({
        next: "/audit-logs?action=label_created&from=2026-01-01&to=2026-01-31",
        reason: "session_revoked",
      })}`
    );
  });
});
