import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockExportAuditLogs,
  mockGetCurrentOperator,
  mockGetPlatformTenant,
  mockRedirect,
  mockToken,
} = vi.hoisted(() => ({
  mockExportAuditLogs: vi.fn(),
  mockGetCurrentOperator: vi.fn(),
  mockGetPlatformTenant: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
  mockToken: vi.fn(),
}));

vi.mock("#lib/api-client", () => ({
  apiClient: { auditLogs: { exportAuditLogs: mockExportAuditLogs } },
  buildSessionHeaders: (token: string) => ({
    headers: { Authorization: `Bearer ${token}` },
  }),
  resolveAccessToken: mockToken,
}));

vi.mock("#lib/auth", () => ({
  getPlatformCurrentOperator: mockGetCurrentOperator,
}));

vi.mock("#lib/tenants", () => ({
  getPlatformTenant: mockGetPlatformTenant,
}));

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

const { GET } = await import("./route");

const CSV = new TextEncoder().encode(
  "﻿time,actor_public_id,actor_name,actor_role,action,outcome,reason,target_type,target_id,client_ip,tenant_public_id,tenant_name,target_public_id,target_name\r\n"
);

const SESSION = { headers: { Authorization: "Bearer session-token" } };

const download = (query: string) =>
  GET(
    new Request(`https://platform.example.test/api/v1/audit-logs/csv${query}`)
  );

describe("GET /api/v1/audit-logs/csv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToken.mockResolvedValue("session-token");
    mockGetCurrentOperator.mockResolvedValue({
      ok: true,
      operator: {
        name: "Auditor",
        publicId: "SeedPFUSAAA1",
        role: "platform_auditor",
      },
    });
    mockGetPlatformTenant.mockResolvedValue({
      ok: true,
      tenant: { id: "0190f5e2-0000-7000-8000-000000000001", name: "Press" },
    });
    mockExportAuditLogs.mockResolvedValue({ csv: CSV });
  });

  it("forwards the session and the filters, and saves the file under the period", async () => {
    const response = await download(
      "?tenant_id=PressTNNTAAA1&actor_user_public_id=SeedPFUSAAA1&action=tenant_created&created_from=2026-01-01&created_to=2026-01-31"
    );

    expect(mockGetPlatformTenant).toHaveBeenCalledWith("PressTNNTAAA1");
    expect(mockExportAuditLogs).toHaveBeenCalledWith(
      {
        action: "tenant_created",
        actorUserPublicId: "SeedPFUSAAA1",
        endDate: "2026-01-31",
        startDate: "2026-01-01",
        tenantId: "0190f5e2-0000-7000-8000-000000000001",
      },
      SESSION
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="platform-audit-log-2026-01-01--2026-01-31.csv"'
    );
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(CSV);
  });

  it("leaves the file unnarrowed when the query names no filter", async () => {
    await download("?created_from=2026-01-01&created_to=2026-01-31");

    expect(mockGetPlatformTenant).not.toHaveBeenCalled();
    expect(mockExportAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "",
        actorUserPublicId: "",
        tenantId: "",
      }),
      SESSION
    );
  });

  it.each([
    ["without an end", "?created_from=2026-01-01"],
    [
      "for a day that is not on the calendar",
      "?created_from=2026-02-30&created_to=2026-03-09",
    ],
    [
      "for an empty filter",
      "?created_from=2026-01-01&created_to=2026-01-31&action=",
    ],
  ])("answers not found %s", async (_label, query) => {
    const response = await download(query);

    expect(response.status).toBe(404);
    expect(mockExportAuditLogs).not.toHaveBeenCalled();
  });

  it("answers not found for a tenant that is not there", async () => {
    mockGetPlatformTenant.mockResolvedValueOnce({ ok: true, tenant: null });

    const response = await download(
      "?tenant_id=GoneTNNTAAA1&created_from=2026-01-01&created_to=2026-01-31"
    );

    expect(response.status).toBe(404);
    expect(mockExportAuditLogs).not.toHaveBeenCalled();
  });

  it("answers not found for a period the API refuses", async () => {
    mockExportAuditLogs.mockRejectedValueOnce(
      new ConnectError("the period is too long", Code.InvalidArgument)
    );

    const response = await download(
      "?created_from=2025-01-01&created_to=2026-01-31"
    );

    expect(response.status).toBe(404);
  });

  it("sends a rejected session to login and back to the same list", async () => {
    mockExportAuditLogs.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    await expect(
      download(
        "?action=tenant_created&created_from=2026-01-01&created_to=2026-01-31"
      )
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith(
      `/login?${new URLSearchParams({
        next: "/audit-logs?action=tenant_created&created_from=2026-01-01&created_to=2026-01-31",
        reason: "session_revoked",
      })}`
    );
  });

  it("sends a session rejected before the tenant is read back to the same list", async () => {
    mockGetCurrentOperator.mockResolvedValueOnce({
      ok: false,
      requiresSignIn: true,
    });

    await expect(
      download(
        "?tenant_id=PressTNNTAAA1&created_from=2026-01-01&created_to=2026-01-31"
      )
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith(
      `/login?${new URLSearchParams({
        next: "/audit-logs?tenant_id=PressTNNTAAA1&created_from=2026-01-01&created_to=2026-01-31",
        reason: "session_revoked",
      })}`
    );
    expect(mockGetPlatformTenant).not.toHaveBeenCalled();
    expect(mockExportAuditLogs).not.toHaveBeenCalled();
  });
});
