import {
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { CoinTransactionKind } from "@publira/api-client/public/coin";
import { ClientSurface } from "@publira/api-client/public/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  coinPackCovering,
  getCoinSettings,
  getMyCoinBalance,
  listMyCoinTransactions,
} from "./coins";
import type { CoinPackItem } from "./coins";

const {
  mockCacheTag,
  mockGetCoinBalance,
  mockGetCoinSettings,
  mockListCoinTransactions,
  mockResolveAccessToken,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetCoinBalance: vi.fn(),
  mockGetCoinSettings: vi.fn(),
  mockListCoinTransactions: vi.fn(),
  mockResolveAccessToken: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    coin: {
      getCoinBalance: mockGetCoinBalance,
      getCoinSettings: mockGetCoinSettings,
      listCoinTransactions: mockListCoinTransactions,
    },
  },
  buildSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
  resolveAccessToken: mockResolveAccessToken,
}));

const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const coinsUnavailable = () =>
  new ConnectError("off", Code.FailedPrecondition, undefined, [
    {
      desc: ErrorInfoSchema,
      value: { domain: "publira", reason: "COINS_UNAVAILABLE" },
    },
  ]);

const pack = (
  overrides: Partial<CoinPackItem> & Pick<CoinPackItem, "id">
): CoinPackItem => ({
  bonusCoins: 0,
  coins: 100,
  currency: "JPY",
  price: 100,
  publicId: overrides.id.toUpperCase(),
  ...overrides,
});

describe("getCoinSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the tenant's coins in the reader's locale under the catalog's detail tag", async () => {
    mockGetCoinSettings.mockResolvedValueOnce({
      settings: {
        coinName: "Points",
        disclosures: {
          contact: "support@example.com",
          issuerName: "Example Inc.",
          notice: "",
          termsUrl: "https://example.com/terms",
        },
        expiryDays: 180,
        packs: [
          {
            bonusCoins: 100,
            coins: 1000,
            currency: "JPY",
            id: "pack-1",
            price: 1000,
            publicId: "PACK1",
          },
        ],
        selling: true,
      },
    });

    await expect(getCoinSettings(tenantId, "en")).resolves.toEqual({
      ok: true,
      value: {
        coinName: "Points",
        disclosures: {
          contact: "support@example.com",
          issuerName: "Example Inc.",
          notice: "",
          termsUrl: "https://example.com/terms",
        },
        expiryDays: 180,
        packs: [
          {
            bonusCoins: 100,
            coins: 1000,
            currency: "JPY",
            id: "pack-1",
            price: 1000,
            publicId: "PACK1",
          },
        ],
        selling: true,
      },
    });
    expect(mockGetCoinSettings).toHaveBeenCalledWith({
      locale: "en",
      tenant: { tenantId },
    });
    expect(mockCacheTag).toHaveBeenCalledWith(
      `tenant:${tenantId}:series:detail`
    );
  });

  it("answers nothing while the tenant offers no coins", async () => {
    mockGetCoinSettings.mockRejectedValueOnce(coinsUnavailable());

    await expect(getCoinSettings(tenantId, "en")).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it("reports a read that failed instead of throwing", async () => {
    mockGetCoinSettings.mockRejectedValueOnce(
      new ConnectError("down", Code.Unavailable)
    );

    await expect(getCoinSettings(tenantId, "en")).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("the settings a reader is shown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists no pack while the tenant is not selling them", async () => {
    mockGetCoinSettings.mockResolvedValueOnce({
      settings: {
        coinName: "Points",
        expiryDays: 30,
        packs: [{ coins: 100, currency: "JPY", id: "pack-1", price: 100 }],
        selling: false,
      },
    });

    await expect(getCoinSettings(tenantId, "en")).resolves.toMatchObject({
      ok: true,
      value: { packs: [], selling: false },
    });
  });

  it("drops a terms URL that is not http or https", async () => {
    mockGetCoinSettings.mockResolvedValueOnce({
      settings: {
        coinName: "Points",
        disclosures: {
          issuerName: "Example Inc.",
          termsUrl: "ftp://example.com/terms",
        },
        expiryDays: 30,
        packs: [],
        selling: true,
      },
    });

    await expect(getCoinSettings(tenantId, "en")).resolves.toMatchObject({
      ok: true,
      value: { disclosures: { issuerName: "Example Inc.", termsUrl: "" } },
    });
  });
});

describe("getMyCoinBalance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("reads the balance with the reader's session", async () => {
    mockGetCoinBalance.mockResolvedValueOnce({
      balance: {
        coinName: "Points",
        coins: 120n,
        nearestExpiryAt: "2026-12-01T00:00:00Z",
        nearestExpiryCoins: 20n,
        shortfallCoins: 0n,
      },
    });

    await expect(getMyCoinBalance(tenantId, "en")).resolves.toEqual({
      ok: true,
      value: {
        coinName: "Points",
        coins: 120,
        nearestExpiryAt: "2026-12-01T00:00:00Z",
        nearestExpiryCoins: 20,
        owedCoins: 0,
      },
    });
    expect(mockGetCoinBalance).toHaveBeenCalledWith(
      { locale: "en", tenant: { tenantId } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("asks a reader with no session to sign in", async () => {
    mockResolveAccessToken.mockResolvedValueOnce("");

    await expect(getMyCoinBalance(tenantId, "en")).resolves.toMatchObject({
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetCoinBalance).not.toHaveBeenCalled();
  });

  it("answers nothing while the tenant offers no coins", async () => {
    mockGetCoinBalance.mockRejectedValueOnce(coinsUnavailable());

    await expect(getMyCoinBalance(tenantId, "en")).resolves.toEqual({
      ok: true,
      value: null,
    });
  });

  it("asks a reader whose session the API rejected to sign in again", async () => {
    mockGetCoinBalance.mockRejectedValueOnce(
      new ConnectError("expired", Code.Unauthenticated)
    );

    await expect(getMyCoinBalance(tenantId, "en")).resolves.toMatchObject({
      ok: false,
      requiresSignIn: true,
    });
  });

  it("lets a failure nothing classifies reach the error boundary", async () => {
    mockGetCoinBalance.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    await expect(getMyCoinBalance(tenantId, "en")).rejects.toThrow("boom");
  });
});

describe("listMyCoinTransactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("reads the page the token names as the web storefront", async () => {
    mockListCoinTransactions.mockResolvedValueOnce({
      coinName: "Points",
      nextToken: "next",
      previousToken: "previous",
      transactions: [
        {
          coins: 1100,
          createdAt: "2026-10-01T00:00:00Z",
          expiresAt: "2027-03-30T00:00:00Z",
          id: "grant-1",
          kind: CoinTransactionKind.GRANT,
          purchaseId: "purchase-1",
        },
        {
          coins: 1,
          createdAt: "2026-10-01T00:00:00Z",
          expiresAt: "",
          id: "unknown-1",
          kind: CoinTransactionKind.UNSPECIFIED,
          purchaseId: "",
        },
      ],
    });

    await expect(
      listMyCoinTransactions(tenantId, { locale: "en", token: "cursor" })
    ).resolves.toEqual({
      ok: true,
      value: {
        coinName: "Points",
        nextToken: "next",
        previousToken: "previous",
        transactions: [
          {
            coins: 1100,
            createdAt: "2026-10-01T00:00:00Z",
            episode: undefined,
            expiresAt: "2027-03-30T00:00:00Z",
            id: "grant-1",
            kind: "grant",
          },
        ],
      },
    });
    expect(mockListCoinTransactions).toHaveBeenCalledWith(
      {
        limit: 20,
        locale: "en",
        surface: ClientSurface.WEB,
        tenant: { tenantId },
        token: "cursor",
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });
});

describe("a spend in the history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAccessToken.mockResolvedValue("session-token");
  });

  it("names the episode it paid for, in the locale its title is written in", async () => {
    mockListCoinTransactions.mockResolvedValueOnce({
      coinName: "Points",
      nextToken: "",
      previousToken: "",
      transactions: [
        {
          coins: 30,
          createdAt: "2026-10-02T00:00:00Z",
          episode: {
            locale: "ja",
            orderIndex: 3,
            publicId: "EP3",
            title: "Third",
          },
          expiresAt: "",
          id: "spend-1",
          kind: CoinTransactionKind.SPEND,
          series: { publicId: "SR1", title: "A series" },
        },
      ],
    });

    await expect(
      listMyCoinTransactions(tenantId, { locale: "en", token: "" })
    ).resolves.toMatchObject({
      ok: true,
      value: {
        transactions: [
          {
            episode: {
              locale: "ja",
              orderIndex: 3,
              publicId: "EP3",
              seriesPublicId: "SR1",
              seriesTitle: "A series",
              title: "Third",
            },
            kind: "spend",
          },
        ],
      },
    });
  });
});

describe("coinPackCovering", () => {
  const packs = [
    pack({ coins: 500, id: "p500", price: 500 }),
    pack({ coins: 100, id: "p100", price: 100 }),
    pack({ bonusCoins: 50, coins: 250, id: "p300", price: 300 }),
    pack({ coins: 300, id: "p300b", price: 320 }),
  ];

  it("offers the smallest pack that covers what the reader needs", () => {
    expect(coinPackCovering(packs, 120)?.id).toBe("p300");
  });

  it("counts a pack's bonus coins, and prefers the cheaper of two that grant as many", () => {
    expect(coinPackCovering(packs, 300)?.id).toBe("p300");
  });

  it("offers none when no pack is large enough", () => {
    expect(coinPackCovering(packs, 501)).toBeUndefined();
  });
});
