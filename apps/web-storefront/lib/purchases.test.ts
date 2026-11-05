import { Code, ConnectError } from "@publira/api-client/errors";
import { ClientSurface, PurchaseKind } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { tenantPurchasesTag } from "./cache-tags";
import { findMyEpisodePurchase, listMyPurchases } from "./purchases";

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

  it("keeps the price before a promotion code and the code beside what was paid", async () => {
    mockListMyPurchases.mockResolvedValueOnce({
      nextToken: "",
      previousToken: "",
      purchases: [
        {
          currency: "JPY",
          id: "PURCHASE01",
          listPrice: 300,
          priceAtPurchase: 240,
          promotionCode: "SPRING10",
        },
        // A server that predates promotion codes answers no list price.
        {
          currency: "JPY",
          id: "PURCHASE02",
          listPrice: 0,
          priceAtPurchase: 300,
        },
      ],
    });

    const result = await listMyPurchases(TENANT_ID, { locale: "en" });

    expect(
      result.purchases.map(({ listPrice, priceAtPurchase, promotionCode }) => ({
        listPrice,
        priceAtPurchase,
        promotionCode,
      }))
    ).toEqual([
      { listPrice: 300, priceAtPurchase: 240, promotionCode: "SPRING10" },
      { listPrice: 300, priceAtPurchase: 300, promotionCode: "" },
    ]);
  });

  it("says how many coins an episode paid with them took, in the tenant's word for them", async () => {
    mockListMyPurchases.mockResolvedValueOnce({
      nextToken: "",
      previousToken: "",
      purchases: [
        {
          coinName: "Points",
          coinsSpent: 300,
          currency: "JPY",
          id: "PURCHASE01",
          priceAtPurchase: 0,
        },
        { currency: "JPY", id: "PURCHASE02", priceAtPurchase: 300 },
      ],
    });

    const result = await listMyPurchases(TENANT_ID, { locale: "en" });

    expect(result.purchases.map(({ coinsSpent }) => coinsSpent)).toEqual([
      { coinName: "Points", count: 300 },
      undefined,
    ]);
  });

  it("keeps the tax a purchase was charged, and none where it was charged none", async () => {
    mockListMyPurchases.mockResolvedValueOnce({
      nextToken: "",
      previousToken: "",
      purchases: [
        {
          currency: "JPY",
          id: "PURCHASE01",
          priceAtPurchase: 1100,
          taxAmount: 100,
          taxRateBps: 1000,
        },
        { currency: "JPY", id: "PURCHASE02", priceAtPurchase: 500 },
      ],
    });

    const result = await listMyPurchases(TENANT_ID, { locale: "en" });

    expect(result.purchases.map(({ tax }) => tax)).toEqual([
      { amount: 100, rateBps: 1000 },
      undefined,
    ]);
  });

  it("says which purchases a store charged", async () => {
    mockListMyPurchases.mockResolvedValueOnce({
      nextToken: "",
      previousToken: "",
      purchases: [
        { currency: "JPY", id: "PURCHASE01", store: "app_store" },
        { currency: "JPY", id: "PURCHASE02", store: "" },
      ],
    });

    const result = await listMyPurchases(TENANT_ID, { locale: "en" });

    expect(
      result.purchases.map(({ chargedByStore }) => chargedByStore)
    ).toEqual([true, false]);
  });

  it("says which purchases are rentals and which are tips", async () => {
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
        { id: "PURCHASE04", kind: PurchaseKind.TIP },
      ],
    });

    const result = await listMyPurchases(TENANT_ID, { locale: "en" });

    expect(result.purchases.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "PURCHASE01", kind: "rental" },
      { id: "PURCHASE02", kind: "purchase" },
      { id: "PURCHASE03", kind: "purchase" },
      { id: "PURCHASE04", kind: "tip" },
    ]);
  });

  it("says what each purchase bought: an episode, a volume, the rest of a series, or a pack", async () => {
    mockListMyPurchases.mockResolvedValueOnce({
      nextToken: "",
      previousToken: "",
      purchases: [
        {
          episode: { orderIndex: 3, publicId: "EPISODE03", title: "Harbor" },
          id: "PURCHASE01",
        },
        {
          id: "PURCHASE02",
          volume: { orderIndex: 1, publicId: "VOLUME01", title: "Volume 1" },
        },
        { id: "PURCHASE03", seriesBundle: { episodeCount: 4 } },
        {
          coinName: "Points",
          coinPack: { bonusCoins: 100, coins: 1000, publicId: "PACK01" },
          id: "PURCHASE04",
        },
      ],
    });

    const result = await listMyPurchases(TENANT_ID, { locale: "en" });

    expect(result.purchases.map(({ item }) => item)).toEqual([
      {
        kind: "episode",
        orderIndex: 3,
        publicId: "EPISODE03",
        title: "Harbor",
      },
      { kind: "volume", publicId: "VOLUME01", title: "Volume 1" },
      { episodeCount: 4, kind: "series_bundle" },
      { bonusCoins: 100, coinName: "Points", coins: 1000, kind: "coin_pack" },
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

const purchaseOf = (publicId: string, id: string, isActive = true) => ({
  episode: { publicId },
  id,
  isActive,
  kind: PurchaseKind.PURCHASE,
});

describe("findMyEpisodePurchase", () => {
  beforeEach(() => {
    mockResolveAccessToken.mockResolvedValue(ACCESS_TOKEN);
  });

  it("finds the newest purchase that opens the episode", async () => {
    mockListMyPurchases.mockResolvedValueOnce({
      purchases: [
        purchaseOf("EP_OTHER", "other"),
        purchaseOf("EP_001", "current"),
        purchaseOf("EP_001", "older"),
      ],
    });

    const purchase = await findMyEpisodePurchase(TENANT_ID, "EP_001", "en");

    expect(purchase?.id).toBe("current");
  });

  it("does not take a rental that ran out, a refund, or a tip for the checkout still on its way", async () => {
    mockListMyPurchases.mockResolvedValueOnce({
      purchases: [purchaseOf("EP_001", "expired", false)],
    });

    await expect(
      findMyEpisodePurchase(TENANT_ID, "EP_001", "en")
    ).resolves.toBeNull();
  });

  it("finds nothing for a guest", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");
    mockListMyPurchases.mockClear();

    await expect(
      findMyEpisodePurchase(TENANT_ID, "EP_001", "en")
    ).resolves.toBeNull();
    expect(mockListMyPurchases).not.toHaveBeenCalled();
  });

  it("finds nothing when the list could not be read", async () => {
    mockListMyPurchases.mockRejectedValueOnce(
      new ConnectError("unavailable", Code.Unavailable)
    );

    await expect(
      findMyEpisodePurchase(TENANT_ID, "EP_001", "en")
    ).resolves.toBeNull();
  });

  it("throws an answer it cannot account for, for the notice's boundary", async () => {
    const failure = new ConnectError("internal", Code.Internal);

    mockListMyPurchases.mockRejectedValueOnce(failure);

    await expect(findMyEpisodePurchase(TENANT_ID, "EP_001", "en")).rejects.toBe(
      failure
    );
  });
});
