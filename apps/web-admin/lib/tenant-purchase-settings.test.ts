import { SurfaceAvailability } from "@publira/api-client/admin/types";
import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantPurchaseSettingsApi,
  mockUpdateTenantPurchaseSettingsApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantPurchaseSettingsApi: vi.fn(),
  mockUpdateTenantPurchaseSettingsApi: vi.fn(),
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
    tenantSettings: {
      getTenantPurchaseSettings: mockGetTenantPurchaseSettingsApi,
      updateTenantPurchaseSettings: mockUpdateTenantPurchaseSettingsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const fieldViolation = (field: string) =>
  new ConnectError(
    "store URL must be an https:// URL",
    Code.InvalidArgument,
    undefined,
    [
      {
        desc: BadRequestSchema,
        value: { fieldViolations: [{ field }] },
      },
    ]
  );

describe("tenant-purchase-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("reads the default, the store addresses, and the tips under the tenant's tag", async () => {
    mockGetTenantPurchaseSettingsApi.mockResolvedValueOnce({
      settings: {
        appStoreUrl: "https://apps.apple.com/app/id123",
        googlePlayUrl: "",
        purchaseAvailability: SurfaceAvailability.APP,
        tips: { amounts: [100, 300], enabled: true },
      },
    });

    const { getTenantPurchaseSettings } =
      await import("./tenant-purchase-settings");

    const result = await getTenantPurchaseSettings("TENANT001", "en");

    expect(result).toEqual({
      ok: true,
      settings: {
        appStoreUrl: "https://apps.apple.com/app/id123",
        googlePlayUrl: "",
        purchaseAvailability: "app",
        tips: { amounts: [100, 300], enabled: true },
      },
    });
    expect(mockGetTenantPurchaseSettingsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:purchase-settings"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  // A server of the release before tips answers none.
  it("reads tips a server does not answer as off with no amounts", async () => {
    mockGetTenantPurchaseSettingsApi.mockResolvedValueOnce({
      settings: { purchaseAvailability: SurfaceAvailability.ALL },
    });

    const { getTenantPurchaseSettings } =
      await import("./tenant-purchase-settings");

    const result = await getTenantPurchaseSettings("TENANT001", "en");

    expect(result).toMatchObject({
      ok: true,
      settings: { tips: { amounts: [], enabled: false } },
    });
  });

  // The API never answers unspecified for the tenant. Reading it as a choice
  // would open the settings, and name the series' option, on a value nobody
  // stored.
  it("reports a default that names no surface", async () => {
    mockGetTenantPurchaseSettingsApi.mockResolvedValueOnce({
      settings: { purchaseAvailability: SurfaceAvailability.UNSPECIFIED },
    });

    const { getTenantPurchaseSettings } =
      await import("./tenant-purchase-settings");

    const result = await getTenantPurchaseSettings("TENANT001", "en");

    expect(result).toEqual({
      message:
        "Could not load where episodes are sold. Please try again later.",
      ok: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("asks for a sign-in when there is no session", async () => {
    mockGetAccessToken.mockResolvedValueOnce("");

    const { getTenantPurchaseSettings } =
      await import("./tenant-purchase-settings");

    const result = await getTenantPurchaseSettings("TENANT001", "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockGetTenantPurchaseSettingsApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports a read the API could not answer", async () => {
    mockGetTenantPurchaseSettingsApi.mockRejectedValueOnce(
      new ConnectError("purchase settings unavailable", Code.Unavailable)
    );

    const { getTenantPurchaseSettings } =
      await import("./tenant-purchase-settings");

    const result = await getTenantPurchaseSettings("TENANT001", "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: false });
    expect(result).not.toHaveProperty("settings");
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  // The cache fill itself must not throw, or the request fails before any
  // boundary can render; the exported read throws once outside the scope.
  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockGetTenantPurchaseSettingsApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { getTenantPurchaseSettings } =
      await import("./tenant-purchase-settings");

    await expect(getTenantPurchaseSettings("TENANT001", "en")).rejects.toThrow(
      Error
    );
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("writes every field but the tips and reads back what was stored", async () => {
    mockUpdateTenantPurchaseSettingsApi.mockResolvedValueOnce({
      settings: {
        appStoreUrl: "",
        googlePlayUrl: "https://play.google.com/store/apps/details?id=a.b",
        purchaseAvailability: SurfaceAvailability.WEB,
      },
    });

    const { updateTenantPurchaseSettings } =
      await import("./tenant-purchase-settings");

    const result = await updateTenantPurchaseSettings(
      {
        appStoreUrl: "",
        googlePlayUrl: "https://play.google.com/store/apps/details?id=a.b",
        purchaseAvailability: "web",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(mockUpdateTenantPurchaseSettingsApi).toHaveBeenCalledWith(
      {
        settings: {
          appStoreUrl: "",
          googlePlayUrl: "https://play.google.com/store/apps/details?id=a.b",
          purchaseAvailability: SurfaceAvailability.WEB,
        },
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    // Unset, the API keeps the tenant's tips as they are.
    expect(
      mockUpdateTenantPurchaseSettingsApi.mock.calls[0]?.[0].settings.tips
    ).toBeUndefined();
    expect(result).toEqual({
      ok: true,
      settings: {
        appStoreUrl: "",
        googlePlayUrl: "https://play.google.com/store/apps/details?id=a.b",
        purchaseAvailability: "web",
        tips: { amounts: [], enabled: false },
      },
    });
  });

  it.each([
    [
      "settings.app_store_url",
      "Enter the App Store address as an https:// URL, or leave it empty.",
    ],
    [
      "settings.google_play_url",
      "Enter the Google Play address as an https:// URL, or leave it empty.",
    ],
  ])("names the address the API refused in %s", async (field, message) => {
    mockUpdateTenantPurchaseSettingsApi.mockRejectedValueOnce(
      fieldViolation(field)
    );

    const { updateTenantPurchaseSettings } =
      await import("./tenant-purchase-settings");

    const result = await updateTenantPurchaseSettings(
      {
        appStoreUrl: "https://apps.apple.com/app/id123",
        googlePlayUrl: "",
        purchaseAvailability: "all",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({ message, ok: false });
  });

  it("writes the tips beside the other settings as the API answers them now", async () => {
    mockGetTenantPurchaseSettingsApi.mockResolvedValueOnce({
      settings: {
        appStoreUrl: "https://apps.apple.com/app/id123",
        googlePlayUrl: "",
        purchaseAvailability: SurfaceAvailability.APP,
        tips: { amounts: [], enabled: false },
      },
    });
    mockUpdateTenantPurchaseSettingsApi.mockResolvedValueOnce({
      settings: {
        appStoreUrl: "https://apps.apple.com/app/id123",
        googlePlayUrl: "",
        purchaseAvailability: SurfaceAvailability.APP,
        tips: { amounts: [100, 300, 1000], enabled: true },
      },
    });

    const { updateTenantTipSettings } =
      await import("./tenant-purchase-settings");

    const result = await updateTenantTipSettings(
      {
        tenantId: " TENANT001 ",
        tips: { amounts: [100, 300, 1000], enabled: true },
      },
      "en"
    );

    expect(mockUpdateTenantPurchaseSettingsApi).toHaveBeenCalledWith(
      {
        settings: {
          appStoreUrl: "https://apps.apple.com/app/id123",
          googlePlayUrl: "",
          purchaseAvailability: SurfaceAvailability.APP,
          tips: { amounts: [100, 300, 1000], enabled: true },
        },
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toMatchObject({
      ok: true,
      settings: { tips: { amounts: [100, 300, 1000], enabled: true } },
    });
  });

  it("writes no tips when the other settings could not be read", async () => {
    mockGetTenantPurchaseSettingsApi.mockRejectedValueOnce(
      new ConnectError("purchase settings unavailable", Code.Unavailable)
    );

    const { updateTenantTipSettings } =
      await import("./tenant-purchase-settings");

    const result = await updateTenantTipSettings(
      { tenantId: "TENANT001", tips: { amounts: [100], enabled: true } },
      "en"
    );

    expect(result).toMatchObject({ ok: false });
    expect(mockUpdateTenantPurchaseSettingsApi).not.toHaveBeenCalled();
  });

  it("names the tip amounts the API refused", async () => {
    mockGetTenantPurchaseSettingsApi.mockResolvedValueOnce({
      settings: { purchaseAvailability: SurfaceAvailability.ALL },
    });
    mockUpdateTenantPurchaseSettingsApi.mockRejectedValueOnce(
      fieldViolation("settings.tips.amounts")
    );

    const { updateTenantTipSettings } =
      await import("./tenant-purchase-settings");

    const result = await updateTenantTipSettings(
      { tenantId: "TENANT001", tips: { amounts: [100], enabled: true } },
      "en"
    );

    const message =
      "Check Tip amounts. Enter up to 6 amounts, each above 0 and none twice, and at least one while tips are on.";

    expect(result).toEqual({ message, ok: false, tipAmountsError: message });
  });

  it("words a failure the API gave no reason for as the tips'", async () => {
    mockGetTenantPurchaseSettingsApi.mockResolvedValueOnce({
      settings: { purchaseAvailability: SurfaceAvailability.ALL },
    });
    mockUpdateTenantPurchaseSettingsApi.mockResolvedValueOnce({
      settings: { purchaseAvailability: SurfaceAvailability.UNSPECIFIED },
    });

    const { updateTenantTipSettings } =
      await import("./tenant-purchase-settings");

    const result = await updateTenantTipSettings(
      { tenantId: "TENANT001", tips: { amounts: [100], enabled: true } },
      "en"
    );

    expect(result).toEqual({
      message: "Could not save the tip settings. Please try again later.",
      ok: false,
    });
  });
});
