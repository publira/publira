import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockCreateCoinPack,
  mockFindTenantLocales,
  mockGetTenantCurrency,
  mockReadCoinPacksForWrite,
  mockReorderCoinPacks,
  mockUpdateCoinPack,
  mockUpdateCoinSettings,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockCreateCoinPack: vi.fn(),
  mockFindTenantLocales: vi.fn(),
  mockGetTenantCurrency: vi.fn(),
  mockReadCoinPacksForWrite: vi.fn(),
  mockReorderCoinPacks: vi.fn(),
  mockUpdateCoinPack: vi.fn(),
  mockUpdateCoinSettings: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("#lib/action-messages", () => ({
  getActionLocale: () => Promise.resolve("en"),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/auth-session", () => ({
  withAdminSessionReauth: <T>(run: () => Promise<T>) => run(),
}));

vi.mock("#lib/public-api", () => ({
  getTenantCurrency: mockGetTenantCurrency,
}));

vi.mock("#lib/tenant-locales", () => ({
  findTenantLocales: mockFindTenantLocales,
}));

vi.mock("#lib/coins", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createCoinPack: mockCreateCoinPack,
  readCoinPacksForWrite: mockReadCoinPacksForWrite,
  reorderCoinPacks: mockReorderCoinPacks,
  updateCoinPack: mockUpdateCoinPack,
  updateCoinSettings: mockUpdateCoinSettings,
}));

const PACK_ONE = "018f0e6a-6000-7000-8000-0000000000d1";
const PACK_TWO = "018f0e6a-6000-7000-8000-0000000000d2";

const formData = (fields: Record<string, string>) => {
  const data = new FormData();
  data.set("tenant_id", "TENANT001");
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
};

/** What the settings form posts with everything coins need filled in. */
const settingsForm = (fields: Record<string, string> = {}) =>
  formData({
    coin_name: "Points",
    coin_unit_amount: "10",
    contact: "support@example.com",
    currency: "JPY",
    enabled: "on",
    expiry_days: "180",
    issuer_name: "Harbor Press Ltd.",
    "name.en": "Points",
    "name.ja": "",
    notice: "Unused Points are not refunded.",
    selling: "on",
    terms_url: "https://example.com/terms",
    ...fields,
  });

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

describe("coin settings actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTenantCurrency.mockResolvedValue("JPY");
    mockFindTenantLocales.mockResolvedValue({
      defaultLocale: "en",
      supportedLocales: ["en", "ja"],
    });
    mockUpdateCoinSettings.mockResolvedValue({ ok: true });
    mockReadCoinPacksForWrite.mockResolvedValue({
      ok: true,
      packs: [storedPack(PACK_ONE, 0), storedPack(PACK_TWO, 4)],
    });
  });

  it("saves the names, the amounts, the disclosures, and both switches", async () => {
    const { updateCoinSettingsAction } = await import("./actions");
    const result = await updateCoinSettingsAction(null, settingsForm());

    expect(result).toEqual({
      message: "The coin settings were saved.",
      ok: true,
    });
    expect(mockUpdateCoinSettings).toHaveBeenCalledWith(
      {
        coinName: "Points",
        currency: "JPY",
        defaultLocale: "en",
        settings: {
          coinUnitAmount: 10,
          contact: "support@example.com",
          enabled: true,
          expiryDays: 180,
          issuerName: "Harbor Press Ltd.",
          // The language left empty loses its name rather than saving one.
          names: [{ locale: "en", name: "Points" }],
          notice: "Unused Points are not refunded.",
          selling: true,
          termsUrl: "https://example.com/terms",
        },
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:coins");
  });

  it("refuses a save without the name in the default language, naming that field", async () => {
    const { updateCoinSettingsAction } = await import("./actions");
    const result = await updateCoinSettingsAction(
      null,
      settingsForm({ enabled: "", "name.en": "  ", selling: "" })
    );

    expect(result).toEqual({
      fieldErrors: { "name.en": "Enter the name in English." },
      message: expect.any(String),
      ok: false,
    });
    expect(mockUpdateCoinSettings).not.toHaveBeenCalled();
  });

  it("names every field coins cannot be turned on without", async () => {
    const { updateCoinSettingsAction } = await import("./actions");
    const result = await updateCoinSettingsAction(
      null,
      settingsForm({
        coin_unit_amount: "",
        contact: "",
        expiry_days: "",
        issuer_name: "",
        notice: "",
        terms_url: "",
      })
    );

    expect(result).toMatchObject({
      fieldErrors: {
        coinUnitAmount: "Enter what one coin is worth to turn coins on.",
        contact: "Enter a contact to turn coins on.",
        expiryDays: "Enter the days until expiry to turn coins on.",
        issuerName: "Enter the issuer name to turn coins on.",
        notice: "Enter a notice to turn coins on.",
        termsUrl: "Enter the terms URL to turn coins on.",
      },
      ok: false,
    });
    expect(mockUpdateCoinSettings).not.toHaveBeenCalled();
  });

  it("saves coins that are off with nothing but the name", async () => {
    const { updateCoinSettingsAction } = await import("./actions");
    const result = await updateCoinSettingsAction(
      null,
      formData({ currency: "JPY", "name.en": "Points" })
    );

    expect(result).toMatchObject({ ok: true });
    expect(mockUpdateCoinSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          coinUnitAmount: 0,
          enabled: false,
          expiryDays: 0,
          selling: false,
        }),
      }),
      "en"
    );
  });

  it("passes on a refusal the API reported against a field", async () => {
    mockUpdateCoinSettings.mockResolvedValueOnce({
      fieldErrors: { enabled: "3 readers still hold Points." },
      message: "Please check the highlighted fields.",
      ok: false,
    });

    const { updateCoinSettingsAction } = await import("./actions");
    const result = await updateCoinSettingsAction(
      null,
      settingsForm({ enabled: "" })
    );

    expect(result).toEqual({
      fieldErrors: { enabled: "3 readers still hold Points." },
      message: "Please check the highlighted fields.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("adds a pack after the others, its price read in the tenant's currency", async () => {
    mockCreateCoinPack.mockResolvedValueOnce({ ok: true, pack: {} });

    const { createCoinPackAction } = await import("./actions");
    const result = await createCoinPackAction(
      null,
      formData({
        bonus_coins: "",
        coin_name: "Points",
        coins: "100",
        on_sale: "on",
        price: "1000",
        price_currency: "JPY",
      })
    );

    expect(result).toEqual({ message: "The pack was added.", ok: true });
    expect(mockCreateCoinPack).toHaveBeenCalledWith(
      {
        coinName: "Points",
        pack: {
          bonusCoins: 0,
          coins: 100,
          currency: "JPY",
          onSale: true,
          price: 1000,
          sortOrder: 5,
        },
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:coins");
  });

  it("refuses a pack that would be free", async () => {
    const { createCoinPackAction } = await import("./actions");
    const result = await createCoinPackAction(
      null,
      formData({ coins: "100", price: "0", price_currency: "JPY" })
    );

    expect(result).toEqual({
      message:
        "Enter a price above 0, with no more decimal places than the currency has.",
      ok: false,
    });
    expect(mockCreateCoinPack).not.toHaveBeenCalled();
  });

  it("keeps what a sold pack was bought for, and changes only whether it is on sale", async () => {
    mockReadCoinPacksForWrite.mockResolvedValueOnce({
      ok: true,
      packs: [storedPack(PACK_ONE, 3, { sold: true })],
    });
    mockUpdateCoinPack.mockResolvedValueOnce({ ok: true, pack: {} });

    const { updateCoinPackAction } = await import("./actions");
    const result = await updateCoinPackAction(
      null,
      formData({
        coin_name: "Points",
        coin_pack_id: PACK_ONE,
        // A crafted post cannot change what was bought.
        coins: "999",
        price: "1",
        price_currency: "JPY",
      })
    );

    expect(result).toEqual({ message: "The pack was saved.", ok: true });
    expect(mockUpdateCoinPack).toHaveBeenCalledWith(
      {
        coinName: "Points",
        id: PACK_ONE,
        pack: expect.objectContaining({
          coins: 50,
          currency: "",
          onSale: false,
          price: 500,
          sortOrder: 3,
        }),
        tenantId: "TENANT001",
      },
      "en"
    );
  });

  it("writes a new order and drops the tag even when the write failed part of the way", async () => {
    mockReorderCoinPacks.mockResolvedValueOnce({
      message: "Could not change the order of the packs.",
      ok: false,
    });

    const { reorderCoinPacksAction } = await import("./actions");
    const result = await reorderCoinPacksAction(
      formData({
        coin_pack_ids: JSON.stringify([PACK_TWO, PACK_ONE]),
        expected_coin_pack_ids: JSON.stringify([PACK_ONE, PACK_TWO]),
      })
    );

    expect(result).toEqual({
      message: "Could not change the order of the packs.",
      ok: false,
    });
    expect(mockReorderCoinPacks).toHaveBeenCalledWith(
      {
        expectedIds: [PACK_ONE, PACK_TWO],
        ids: [PACK_TWO, PACK_ONE],
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:coins");
  });
});
