import { ClientSurface, PurchaseKind } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { tenantPurchasesTag } from "./cache-tags";
import { listMyPurchases } from "./purchases";

const { mockCacheTag, mockListMyPurchases, mockResolveAccessToken } =
  vi.hoisted(() => ({
    mockCacheTag: vi.fn(),
    mockListMyPurchases: vi.fn(),
    mockResolveAccessToken: vi.fn(),
  }));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    purchase: { listMyPurchases: mockListMyPurchases },
  },
  buildSessionHeaders: (accessToken: string) => ({
    Authorization: `Bearer ${accessToken}`,
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCESS_TOKEN = "session-token";

describe("listMyPurchases", () => {
  beforeEach(() => {
    mockCacheTag.mockReset();
    mockResolveAccessToken.mockResolvedValue(ACCESS_TOKEN);
    mockListMyPurchases.mockResolvedValue({
      nextToken: "",
      previousToken: "",
      purchases: [],
    });
  });

  it("reads the library the storefront may show", async () => {
    await listMyPurchases(TENANT_ID, { locale: "en" });

    expect(mockListMyPurchases).toHaveBeenCalledWith(
      {
        limit: 20,
        locale: "en",
        surface: ClientSurface.WEB,
        tenant: { tenantId: TENANT_ID },
        token: "",
      },
      { Authorization: `Bearer ${ACCESS_TOKEN}` }
    );
  });

  it("files the library under the reader's purchases tag", async () => {
    await listMyPurchases(TENANT_ID, { locale: "en" });

    expect(mockCacheTag).toHaveBeenCalledWith(tenantPurchasesTag(TENANT_ID));
  });

  it("keeps the currency each purchase was paid in beside its price", async () => {
    mockListMyPurchases.mockResolvedValueOnce({
      nextToken: "",
      previousToken: "",
      purchases: [{ currency: "USD", id: "PURCHASE01", priceAtPurchase: 499 }],
    });

    const result = await listMyPurchases(TENANT_ID, { locale: "en" });

    expect(result.purchases).toEqual([
      expect.objectContaining({ currency: "USD", priceAtPurchase: 499 }),
    ]);
  });

  it("says which purchases are rentals", async () => {
    mockListMyPurchases.mockResolvedValueOnce({
      nextToken: "",
      previousToken: "",
      purchases: [
        {
          expiresAt: "2026-10-03T09:00:00Z",
          id: "PURCHASE01",
          kind: PurchaseKind.RENTAL,
        },
        { id: "PURCHASE02", kind: PurchaseKind.PURCHASE },
        { id: "PURCHASE03" },
      ],
    });

    const result = await listMyPurchases(TENANT_ID, { locale: "en" });

    expect(result.purchases.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "PURCHASE01", kind: "rental" },
      { id: "PURCHASE02", kind: "purchase" },
      { id: "PURCHASE03", kind: "purchase" },
    ]);
  });

  it("keeps what was refunded on each purchase, and when it was refunded and revoked", async () => {
    mockListMyPurchases.mockResolvedValueOnce({
      nextToken: "",
      previousToken: "",
      purchases: [
        {
          id: "PURCHASE01",
          refundedAmount: 499,
          refundedAt: "2026-10-02T09:00:00Z",
          revokedAt: "2026-10-02T09:00:00Z",
        },
        { id: "PURCHASE02" },
      ],
    });

    const result = await listMyPurchases(TENANT_ID, { locale: "en" });

    expect(result.purchases).toEqual([
      expect.objectContaining({
        refundedAmount: 499,
        refundedAt: "2026-10-02T09:00:00Z",
        revokedAt: "2026-10-02T09:00:00Z",
      }),
      expect.objectContaining({
        refundedAmount: 0,
        refundedAt: "",
        revokedAt: "",
      }),
    ]);
  });
});
