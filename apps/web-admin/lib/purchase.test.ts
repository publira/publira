import { PurchaseRevocationReason } from "@publira/api-client/admin/purchase";
import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetPurchase,
  mockListPurchases,
  mockListReaderPurchases,
  mockRefundPurchase,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetPurchase: vi.fn(),
  mockListPurchases: vi.fn(),
  mockListReaderPurchases: vi.fn(),
  mockRefundPurchase: vi.fn(),
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    purchases: {
      getPurchase: mockGetPurchase,
      listPurchases: mockListPurchases,
      listReaderPurchases: mockListReaderPurchases,
      refundPurchase: mockRefundPurchase,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

const PURCHASE_ID = "018f0e6a-5000-7000-8000-000000000001";

const purchase = (
  overrides: Partial<{
    coinName: string;
    coinPack: {
      bonusCoins: number;
      coins: number;
      id: string;
      publicId: string;
    };
    episodeId: string;
    episodePublicId: string;
    episodeTitle: string;
    refundable: boolean;
    revocationReason: PurchaseRevocationReason;
    revokedAt: string;
    seriesBundle: {
      discountPercent: number;
      episodeCount: number;
      id: string;
    };
    volumeId: string;
    volumePublicId: string;
    volumeTitle: string;
  }> = {}
) => ({
  currency: "JPY",
  episodeId: "018f0e6a-5000-7000-8000-000000000002",
  episodePublicId: "EPISODE001",
  episodeTitle: "Episode 1",
  expiresAt: "",
  id: PURCHASE_ID,
  price: 500n,
  provider: "stripe",
  purchasedAt: "2026-03-01T12:00:00Z",
  readerEmail: "reader@example.com",
  readerName: "Reader",
  readerPublicId: "READER001",
  refundable: true,
  refundedAmount: 0n,
  refundedAt: "",
  revocationReason: PurchaseRevocationReason.UNSPECIFIED,
  revokedAt: "",
  seriesPublicId: "SERIES001",
  seriesTitle: "Series 1",
  store: "",
  test: false,
  volumeId: "",
  volumePublicId: "",
  volumeTitle: "",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockGetAccessToken.mockResolvedValue("session-token");
});

describe("listPurchases", () => {
  it("sends every filter with the cursor, carries the list's tag, and maps the rows", async () => {
    mockListPurchases.mockResolvedValue({
      nextToken: "next-page",
      previousToken: "",
      purchases: [purchase()],
    });

    const { listPurchases } = await import("./purchase");

    const result = await listPurchases("TENANT001", "en", {
      episodePublicId: "EPISODE001",
      purchasedFrom: "2026-02-28T15:00:00Z",
      purchasedTo: "2026-03-31T15:00:00Z",
      readerEmail: "reader@example.com",
      seriesPublicId: "SERIES001",
      token: "current-page",
    });

    expect(mockListPurchases).toHaveBeenCalledWith(
      {
        episodePublicId: "EPISODE001",
        limit: 20,
        purchasedFrom: "2026-02-28T15:00:00Z",
        purchasedTo: "2026-03-31T15:00:00Z",
        readerEmail: "reader@example.com",
        seriesPublicId: "SERIES001",
        tenant: { tenantId: "TENANT001" },
        token: "current-page",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith("purchases-TENANT001");
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
    expect(result).toMatchObject({
      nextToken: "next-page",
      ok: true,
      previousToken: "",
      purchases: [
        {
          id: PURCHASE_ID,
          price: 500,
          refundable: true,
          refundedAmount: 0,
          revocationReason: "",
        },
      ],
    });
  });

  it("tells an episode, a volume, and the rest of a series apart", async () => {
    mockListPurchases.mockResolvedValue({
      nextToken: "",
      previousToken: "",
      purchases: [
        purchase(),
        purchase({
          episodeId: "",
          episodePublicId: "",
          episodeTitle: "",
          volumeId: "018f0e6a-5000-7000-8000-000000000003",
          volumePublicId: "VOLUME001",
          volumeTitle: "Volume 1",
        }),
        purchase({
          episodeId: "",
          episodePublicId: "",
          episodeTitle: "",
          seriesBundle: {
            discountPercent: 10,
            episodeCount: 12,
            id: "018f0e6a-5000-7000-8000-000000000004",
          },
        }),
        purchase({
          coinName: "Points",
          coinPack: {
            bonusCoins: 100,
            coins: 1000,
            id: "018f0e6a-5000-7000-8000-000000000005",
            publicId: "PACK00000001",
          },
          episodeId: "",
          episodePublicId: "",
          episodeTitle: "",
        }),
      ],
    });

    const { listPurchases } = await import("./purchase");
    const result = await listPurchases("TENANT001", "en");

    expect(result.purchases.map(({ item }) => item)).toEqual([
      { kind: "episode", publicId: "EPISODE001", title: "Episode 1" },
      { kind: "volume", publicId: "VOLUME001", title: "Volume 1" },
      { episodeCount: 12, kind: "series_bundle" },
      { bonusCoins: 100, coinName: "Points", coins: 1000, kind: "coin_pack" },
    ]);
  });

  it("reports a failure the API classifies as a message instead of throwing", async () => {
    mockListPurchases.mockRejectedValue(
      new ConnectError("down", Code.Unavailable)
    );

    const { listPurchases } = await import("./purchase");
    const result = await listPurchases("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result.purchases).toEqual([]);
    expect(result.message).toBeTruthy();
  });

  it("asks for a sign-in when there is no session, without calling the API", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listPurchases } = await import("./purchase");
    const result = await listPurchases("TENANT001", "en");

    expect(mockListPurchases).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
  });
});

describe("listReaderPurchases", () => {
  const READER_ID = "018f0e6a-5000-7000-8000-000000000003";

  it("names the reader by their primary key, carries the list's tag, and maps the rows", async () => {
    mockListReaderPurchases.mockResolvedValue({
      nextToken: "",
      previousToken: "previous-page",
      purchases: [purchase()],
    });

    const { listReaderPurchases } = await import("./purchase");

    const result = await listReaderPurchases("TENANT001", "en", READER_ID, {
      token: "current-page",
    });

    expect(mockListReaderPurchases).toHaveBeenCalledWith(
      {
        limit: 20,
        readerId: READER_ID,
        tenant: { tenantId: "TENANT001" },
        token: "current-page",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith("purchases-TENANT001");
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
    expect(result).toMatchObject({
      nextToken: "",
      ok: true,
      previousToken: "previous-page",
      purchases: [{ id: PURCHASE_ID, price: 500 }],
    });
  });

  it("reports a failure the API classifies as a message instead of throwing", async () => {
    mockListReaderPurchases.mockRejectedValue(
      new ConnectError("down", Code.Unavailable)
    );

    const { listReaderPurchases } = await import("./purchase");
    const result = await listReaderPurchases("TENANT001", "en", READER_ID);

    expect(result.ok).toBe(false);
    expect(result.purchases).toEqual([]);
    expect(result.message).toBeTruthy();
  });

  it("asks for a sign-in when there is no session, without calling the API", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listReaderPurchases } = await import("./purchase");
    const result = await listReaderPurchases("TENANT001", "en", READER_ID);

    expect(mockListReaderPurchases).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
  });
});

describe("getPurchase", () => {
  it("carries the list's tag, so a refund reaches the drawer too", async () => {
    mockGetPurchase.mockResolvedValue({
      purchase: purchase({
        refundable: false,
        revocationReason: PurchaseRevocationReason.STAFF,
        revokedAt: "2026-03-02T00:00:00Z",
      }),
    });

    const { getPurchase } = await import("./purchase");
    const result = await getPurchase("TENANT001", PURCHASE_ID, "en");

    expect(mockGetPurchase).toHaveBeenCalledWith(
      { purchaseId: PURCHASE_ID, tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith("purchases-TENANT001");
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
    expect(result).toMatchObject({
      ok: true,
      purchase: { refundable: false, revocationReason: "staff" },
    });
  });

  it("answers a purchase the tenant does not hold as none", async () => {
    mockGetPurchase.mockRejectedValue(
      new ConnectError("purchase not found", Code.NotFound)
    );

    const { getPurchase } = await import("./purchase");
    const result = await getPurchase("TENANT001", PURCHASE_ID, "en");

    expect(result).toEqual({ ok: true, purchase: null });
  });
});

describe("refundPurchase", () => {
  it("sends the reason with the purchase and answers the refunded purchase", async () => {
    mockRefundPurchase.mockResolvedValue({
      purchase: purchase({
        refundable: false,
        revocationReason: PurchaseRevocationReason.STAFF,
        revokedAt: "2026-03-02T00:00:00Z",
      }),
    });

    const { refundPurchase } = await import("./purchase");

    const result = await refundPurchase(
      {
        purchaseId: PURCHASE_ID,
        reason: "Bought twice by mistake.",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockRefundPurchase).toHaveBeenCalledWith(
      {
        purchaseId: PURCHASE_ID,
        reason: "Bought twice by mistake.",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({
      ok: true,
      purchase: { revocationReason: "staff" },
    });
  });

  it("words a refund the API refuses as one that cannot be made here", async () => {
    mockRefundPurchase.mockRejectedValue(
      new ConnectError(
        "a store purchase is refunded through the store",
        Code.FailedPrecondition
      )
    );

    const { refundPurchase } = await import("./purchase");

    const result = await refundPurchase(
      {
        purchaseId: PURCHASE_ID,
        reason: "Asked by the reader.",
        tenantId: "T",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "This purchase cannot be refunded. The payment provider refused the refund, or the purchase can no longer be refunded from the console.",
      ok: false,
    });
  });

  it("lets a rejected session reach the re-authentication flow", async () => {
    mockRefundPurchase.mockRejectedValue(
      new ConnectError("expired", Code.Unauthenticated)
    );

    const { refundPurchase } = await import("./purchase");

    await expect(
      refundPurchase(
        {
          purchaseId: PURCHASE_ID,
          reason: "Asked by the reader.",
          tenantId: "T",
        },
        "en"
      )
    ).rejects.toBeInstanceOf(ConnectError);
  });
});
