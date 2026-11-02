import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApi, mockGetAccessToken, mockRedirect } = vi.hoisted(() => ({
  mockApi: {
    auth: { getTenant: vi.fn() },
    paymentReconciliations: { exportPurchases: vi.fn() },
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
  "﻿row_type,purchase_id,occurred_at,purchased_at,amount,currency,kind,item_type,item_id,provider,provider_checkout_id,provider_payment_id,store,store_transaction_id,test\r\n"
);

const SESSION = { headers: { Authorization: "Bearer session-token" } };

const download = (query: string, tenantId = TENANT_ID) =>
  GET(new Request(`https://admin.example.test/api/v1/purchases/csv${query}`), {
    params: Promise.resolve({ tenant_id: tenantId }),
  });

describe("GET /api/v1/purchases/csv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue("session-token");
    mockApi.auth.getTenant.mockResolvedValue({
      tenant: { name: "Purchases Press", publicId: "PrchTNNTAAA1" },
    });
    mockApi.paymentReconciliations.exportPurchases.mockResolvedValue({
      csv: CSV,
    });
  });

  it("forwards the session and the period, and saves the file under the tenant and period", async () => {
    const response = await download("?from=2026-01-01&to=2026-01-31");

    expect(mockApi.paymentReconciliations.exportPurchases).toHaveBeenCalledWith(
      {
        endDate: "2026-01-31",
        startDate: "2026-01-01",
        tenant: { tenantId: TENANT_ID },
      },
      SESSION
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="purchases-PrchTNNTAAA1-2026-01-01--2026-01-31.csv"'
    );
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(CSV);
  });

  it.each([
    ["without an end", "?from=2026-01-01"],
    ["for a day that is not on the calendar", "?from=2026-02-30&to=2026-03-09"],
  ])("answers not found %s", async (_label, query) => {
    const response = await download(query);

    expect(response.status).toBe(404);
    expect(
      mockApi.paymentReconciliations.exportPurchases
    ).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a period the API refuses",
      new ConnectError("the period is too long", Code.InvalidArgument),
    ],
    [
      "a member below tenant admin",
      new ConnectError("tenant admin required", Code.PermissionDenied),
    ],
  ])("answers not found for %s", async (_label, error) => {
    mockApi.paymentReconciliations.exportPurchases.mockRejectedValueOnce(error);

    const response = await download("?from=2026-01-01&to=2026-01-31");

    expect(response.status).toBe(404);
  });

  it("answers not found for a tenant id the proxy would never rewrite", async () => {
    const response = await download(
      "?from=2026-01-01&to=2026-01-31",
      "not-a-tenant"
    );

    expect(response.status).toBe(404);
    expect(
      mockApi.paymentReconciliations.exportPurchases
    ).not.toHaveBeenCalled();
  });

  it("sends a rejected session to login and back to Purchases over the same period", async () => {
    mockApi.paymentReconciliations.exportPurchases.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );
    mockApi.auth.getTenant.mockRejectedValueOnce(
      new ConnectError("session expired", Code.Unauthenticated)
    );

    await expect(download("?from=2026-01-01&to=2026-01-31")).rejects.toThrow(
      "NEXT_REDIRECT"
    );
    expect(mockRedirect).toHaveBeenCalledWith(
      `/login?${new URLSearchParams({
        next: "/purchases?from=2026-01-01&to=2026-01-31",
        reason: "session_revoked",
      })}`
    );
  });
});
