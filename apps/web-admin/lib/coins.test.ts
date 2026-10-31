import {
  BadRequestSchema,
  Code,
  ConnectError,
  ErrorInfoSchema,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantCoinSettingsApi,
  mockListCoinPacksApi,
  mockUpdateCoinPackApi,
  mockUpdateTenantCoinSettingsApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantCoinSettingsApi: vi.fn(),
  mockListCoinPacksApi: vi.fn(),
  mockUpdateCoinPackApi: vi.fn(),
  mockUpdateTenantCoinSettingsApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    coins: {
      getTenantCoinSettings: mockGetTenantCoinSettingsApi,
      listCoinPacks: mockListCoinPacksApi,
      updateCoinPack: mockUpdateCoinPackApi,
      updateTenantCoinSettings: mockUpdateTenantCoinSettingsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const PACK_ONE = "018f0e6a-6000-7000-8000-0000000000d1";
const PACK_TWO = "018f0e6a-6000-7000-8000-0000000000d2";
const PACK_THREE = "018f0e6a-6000-7000-8000-0000000000d3";

const storedSettings = {
  coinUnitAmount: 10,
  contact: "support@example.com",
  enabled: true,
  expiryDays: 180,
  issuerName: "Harbor Press Ltd.",
  names: [
    { locale: "en", name: "Points" },
    { locale: "ja", name: "ポイント" },
  ],
  notice: "Unused Points are not refunded.",
  selling: true,
  termsUrl: "https://example.com/terms",
};

const storedPack = (id: string, sortOrder: number, extra = {}) => ({
  bonusCoins: 0,
  coins: 50,
  currency: "JPY",
  id,
  onSale: true,
  price: 500,
  sold: false,
  sortOrder,
  ...extra,
});

const updateInput = (enabled: boolean) => ({
  coinName: "Points",
  currency: "JPY",
  defaultLocale: "en" as const,
  settings: {
    ...storedSettings,
    enabled,
    names: [{ locale: "en" as const, name: "Points" }],
  },
  tenantId: "TENANT001",
});

describe("coins", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("reads the settings, the platform's allowance, and the currency under the tenant's tag", async () => {
    mockGetTenantCoinSettingsApi.mockResolvedValueOnce({
      currency: "JPY",
      platformAllowsCoins: true,
      settings: {
        ...storedSettings,
        names: [...storedSettings.names, { locale: "xx", name: "Unknown" }],
      },
    });

    const { getCoinSettings } = await import("./coins");
    const result = await getCoinSettings("TENANT001", "en");

    expect(result).toEqual({
      currency: "JPY",
      ok: true,
      platformAllowsCoins: true,
      settings: storedSettings,
    });
    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT001:coins");
    // The platform's allowance changes in the Platform Console, which clears
    // no tag of this app.
    expect(mockCacheLife).toHaveBeenCalledWith("minutes");
  });

  it("names the readers still holding coins when turning coins off is refused", async () => {
    mockUpdateTenantCoinSettingsApi.mockRejectedValueOnce(
      new ConnectError(
        "readers hold coins",
        Code.FailedPrecondition,
        undefined,
        [
          {
            desc: ErrorInfoSchema,
            value: {
              domain: "publira",
              metadata: { reader_count: "3" },
              reason: "COIN_BALANCES_OUTSTANDING",
            },
          },
        ]
      )
    );

    const { updateCoinSettings } = await import("./coins");
    const result = await updateCoinSettings(updateInput(false), "en");

    expect(result).toEqual({
      fieldErrors: {
        enabled:
          "3 readers still hold Points that have not expired, so coins cannot be turned off. Clear Sell packs and save instead, and turn coins off once those Points have expired.",
      },
      message: expect.any(String),
      ok: false,
    });
  });

  it("reports a name the API refused under the field of its language", async () => {
    mockUpdateTenantCoinSettingsApi.mockRejectedValueOnce(
      new ConnectError("name too long", Code.InvalidArgument, undefined, [
        {
          desc: BadRequestSchema,
          value: { fieldViolations: [{ field: "settings.names[0].name" }] },
        },
      ])
    );

    const { updateCoinSettings } = await import("./coins");
    const result = await updateCoinSettings(updateInput(true), "en");

    expect(result).toMatchObject({
      fieldErrors: { "name.en": "Enter a name of 1 to 30 characters." },
      ok: false,
    });
  });

  it("tells a platform that stopped allowing coins from payments that cannot sell a pack", async () => {
    mockUpdateTenantCoinSettingsApi.mockRejectedValue(
      new ConnectError("cannot turn coins on", Code.FailedPrecondition)
    );
    mockGetTenantCoinSettingsApi.mockResolvedValueOnce({
      platformAllowsCoins: false,
    });

    const { updateCoinSettings } = await import("./coins");
    await expect(
      updateCoinSettings(updateInput(true), "en")
    ).resolves.toMatchObject({
      fieldErrors: {
        enabled:
          "The platform does not let tenants issue coins, so they cannot be turned on.",
      },
    });

    mockGetTenantCoinSettingsApi.mockResolvedValueOnce({
      platformAllowsCoins: true,
    });
    await expect(
      updateCoinSettings(updateInput(true), "en")
    ).resolves.toMatchObject({
      fieldErrors: {
        enabled: expect.stringContaining("payment provider or an app store"),
      },
    });
  });

  it("saves only the packs whose position moved, with the rest of each as stored", async () => {
    mockListCoinPacksApi.mockResolvedValueOnce({
      packs: [
        storedPack(PACK_ONE, 0),
        storedPack(PACK_TWO, 1, { sold: true }),
        storedPack(PACK_THREE, 2),
      ],
    });
    mockUpdateCoinPackApi.mockImplementation(({ coinPackId, pack }) =>
      Promise.resolve({ pack: { ...pack, id: coinPackId } })
    );

    const { reorderCoinPacks } = await import("./coins");

    const result = await reorderCoinPacks(
      {
        expectedIds: [PACK_ONE, PACK_TWO, PACK_THREE],
        ids: [PACK_TWO, PACK_ONE, PACK_THREE],
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({ ok: true });
    expect(mockUpdateCoinPackApi).toHaveBeenCalledTimes(2);
    expect(mockUpdateCoinPackApi).toHaveBeenCalledWith(
      {
        coinPackId: PACK_TWO,
        // A sold pack keeps its price, so the currency it was set in is not
        // checked against the tenant's again.
        pack: {
          bonusCoins: 0,
          coins: 50,
          currency: "",
          onSale: true,
          price: 500,
          sortOrder: 0,
        },
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockUpdateCoinPackApi).toHaveBeenCalledWith(
      expect.objectContaining({
        coinPackId: PACK_ONE,
        pack: expect.objectContaining({ sortOrder: 1 }),
      }),
      expect.anything()
    );
  });

  it("refuses an order drawn from a list someone else has changed since", async () => {
    mockListCoinPacksApi.mockResolvedValueOnce({
      packs: [storedPack(PACK_ONE, 0), storedPack(PACK_THREE, 1)],
    });

    const { reorderCoinPacks } = await import("./coins");

    const result = await reorderCoinPacks(
      {
        expectedIds: [PACK_ONE, PACK_TWO],
        ids: [PACK_TWO, PACK_ONE],
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "The packs were changed elsewhere. Reload the page and try again.",
      ok: false,
    });
    expect(mockUpdateCoinPackApi).not.toHaveBeenCalled();
  });

  it("names the state the coins are in, and the word for them a reader of a locale sees", async () => {
    const { coinNameFor, coinStatus } = await import("./coins");

    expect(coinStatus({ enabled: false, selling: true })).toBe("off");
    expect(coinStatus({ enabled: true, selling: true })).toBe("selling");
    expect(coinStatus({ enabled: true, selling: false })).toBe("not_selling");

    const names = [{ locale: "en" as const, name: "Points" }];
    expect(coinNameFor(names, "en", "en")).toBe("Points");
    expect(coinNameFor(names, "ja", "en")).toBe("Points");
    expect(coinNameFor([], "ja", "en")).toBeUndefined();
  });
});
