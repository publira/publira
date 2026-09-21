import { SurfaceAvailability } from "@publira/api-client/admin/types";
import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantPurchaseSettingsApi,
  mockUpdateTenantPurchaseSettingsApi,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantPurchaseSettingsApi: vi.fn(),
  mockUpdateTenantPurchaseSettingsApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
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

const storeUrlError = (field: string) =>
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

  it("reads the default and the store addresses under the tenant's tag", async () => {
    mockGetTenantPurchaseSettingsApi.mockResolvedValueOnce({
      settings: {
        appStoreUrl: "https://apps.apple.com/app/id123",
        googlePlayUrl: "",
        purchaseAvailability: SurfaceAvailability.APP,
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
      },
    });
    expect(mockGetTenantPurchaseSettingsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:purchase-settings"
    );
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
  });

  it("asks for a sign-in when there is no session", async () => {
    mockGetAccessToken.mockResolvedValueOnce("");

    const { getTenantPurchaseSettings } =
      await import("./tenant-purchase-settings");
    const result = await getTenantPurchaseSettings("TENANT001", "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockGetTenantPurchaseSettingsApi).not.toHaveBeenCalled();
  });

  it("writes every field and reads back what was stored", async () => {
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
    expect(result).toEqual({
      ok: true,
      settings: {
        appStoreUrl: "",
        googlePlayUrl: "https://play.google.com/store/apps/details?id=a.b",
        purchaseAvailability: "web",
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
      storeUrlError(field)
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
});
