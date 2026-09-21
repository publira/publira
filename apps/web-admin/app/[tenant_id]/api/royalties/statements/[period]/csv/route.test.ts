import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApi, mockGetAccessToken, mockRedirect } = vi.hoisted(() => ({
  mockApi: {
    auth: { getTenant: vi.fn() },
    royalties: { exportRoyaltyStatement: vi.fn() },
  },
  mockGetAccessToken: vi.fn(),
  mockRedirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => mockApi,
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
  "\uFEFFperiod,creator_id,creator_name\r\n2026-08,,Aki\r\n"
);
const SESSION = { headers: { Authorization: "Bearer session-token" } };

const download = (overrides?: { period?: string; tenantId?: string }) =>
  GET(
    new Request("https://admin.example.test/api/royalties/statements/x/csv"),
    {
      params: Promise.resolve({
        period: overrides?.period ?? "2026-08",
        tenant_id: overrides?.tenantId ?? TENANT_ID,
      }),
    }
  );

describe("GET /api/royalties/statements/[period]/csv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue("session-token");
    mockApi.auth.getTenant.mockResolvedValue({
      tenant: { name: "Royalty Press", publicId: "RoyaTNNTAAA1" },
    });
    mockApi.royalties.exportRoyaltyStatement.mockResolvedValue({ csv: CSV });
  });

  it("forwards the session and saves the statement under the tenant and month", async () => {
    const response = await download();

    expect(mockApi.royalties.exportRoyaltyStatement).toHaveBeenCalledWith(
      { period: "2026-08", tenant: { tenantId: TENANT_ID } },
      SESSION
    );
    expect(mockApi.auth.getTenant).toHaveBeenCalledWith(
      { tenant: { tenantId: TENANT_ID } },
      SESSION
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="royalties-RoyaTNNTAAA1-2026-08.csv"'
    );
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(CSV);
  });

  it("answers not found for a month that is not closed", async () => {
    mockApi.royalties.exportRoyaltyStatement.mockRejectedValueOnce(
      new ConnectError("the month is not closed", Code.FailedPrecondition)
    );

    const response = await download({ period: "2026-09" });

    expect(response.status).toBe(404);
  });

  it("answers not found for a period that is not a month", async () => {
    const response = await download({ period: "2026-13" });

    expect(response.status).toBe(404);
    expect(mockApi.royalties.exportRoyaltyStatement).not.toHaveBeenCalled();
  });

  it("answers not found for a tenant id the proxy would never rewrite", async () => {
    const response = await download({ tenantId: "not-a-tenant" });

    expect(response.status).toBe(404);
    expect(mockApi.royalties.exportRoyaltyStatement).not.toHaveBeenCalled();
  });

  it("sends a rejected session to login and back to the statement", async () => {
    mockApi.royalties.exportRoyaltyStatement.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );
    mockApi.auth.getTenant.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    await expect(download()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith(
      "/login?next=%2Froyalties%2Fstatements%2F2026-08&reason=session_revoked"
    );
  });
});
