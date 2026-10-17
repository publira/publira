import { Code, ConnectError } from "@publira/api-client/errors";
import { ClientSurface } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetTenantDefaultLocale,
  mockGetTenantSupportedLocales,
  mockListMyPurchases,
  mockRedirect,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockGetTenantDefaultLocale: vi.fn(),
  mockGetTenantSupportedLocales: vi.fn(),
  mockListMyPurchases: vi.fn(),
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
  apiClient: { purchase: { listMyPurchases: mockListMyPurchases } },
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
const SESSION = { Authorization: "Bearer session-token" };

const download = (tenantId = TENANT_ID, query = "") =>
  GET(
    new Request(`https://site.example.test/api/v1/my/purchases/csv${query}`),
    { params: Promise.resolve({ tenant_id: tenantId }) }
  );

const page = (ids: string[], nextToken = "") => ({
  nextToken,
  previousToken: "",
  purchases: ids.map((id) => ({
    currency: "JPY",
    episode: { orderIndex: 1, publicId: "EPISODE001", title: "Episode" },
    id,
    isActive: true,
    priceAtPurchase: 500,
    purchasedAt: "2026-10-01T09:00:00Z",
    series: { publicId: "SERIES001", title: "Series" },
  })),
});

describe("GET /api/v1/my/purchases/csv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTenantDefaultLocale.mockResolvedValue("en");
    mockGetTenantSupportedLocales.mockResolvedValue(["en", "ja"]);
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("reads every page of the reader's purchases into one attachment", async () => {
    mockListMyPurchases
      .mockResolvedValueOnce(page(["PURCHASE01", "PURCHASE02"], "NEXT"))
      .mockResolvedValueOnce(page(["PURCHASE03"]));

    const response = await download();

    expect(mockListMyPurchases).toHaveBeenNthCalledWith(
      1,
      {
        limit: 100,
        locale: "en",
        surface: ClientSurface.WEB,
        tenant: { tenantId: TENANT_ID },
        token: "",
      },
      SESSION
    );
    expect(mockListMyPurchases).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ token: "NEXT" }),
      SESSION
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="purchases.csv"'
    );
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const csv = await response.text();
    const rows = csv.split("\r\n");
    expect(rows.slice(1, -1).map((row) => row.split(",")[0])).toEqual([
      "PURCHASE01",
      "PURCHASE02",
      "PURCHASE03",
    ]);
  });

  it("names the works in the language the library linked from", async () => {
    mockListMyPurchases.mockResolvedValueOnce(page(["PURCHASE01"]));

    await download(TENANT_ID, "?locale=ja");

    expect(mockListMyPurchases).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "ja" }),
      SESSION
    );
  });

  it("reads a language the tenant does not offer as its default", async () => {
    mockListMyPurchases.mockResolvedValueOnce(page(["PURCHASE01"]));

    await download(TENANT_ID, "?locale=ko");

    expect(mockListMyPurchases).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "en" }),
      SESSION
    );
  });

  it("sends a signed-out reader to sign in, coming back to the library", async () => {
    mockResolveAccessToken.mockResolvedValue("");

    await expect(download()).rejects.toThrow(
      "NEXT_REDIRECT /login?returnTo=%2Fmy%2Flibrary&reason=session_revoked"
    );
    expect(mockListMyPurchases).not.toHaveBeenCalled();
  });

  it("sends a reader whose session the API rejects to sign in", async () => {
    mockListMyPurchases.mockRejectedValue(
      new ConnectError("expired", Code.Unauthenticated)
    );

    await expect(download()).rejects.toThrow(
      "NEXT_REDIRECT /login?returnTo=%2Fmy%2Flibrary&reason=session_revoked"
    );
  });

  it("answers a path that names no tenant with 404", async () => {
    const response = await download("not-a-tenant");

    expect(response.status).toBe(404);
    expect(mockListMyPurchases).not.toHaveBeenCalled();
  });
});
