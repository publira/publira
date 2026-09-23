import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheTag,
  mockGetAccessToken,
  mockGetApi,
  mockListProductsApi,
  mockUpdateApi,
} = vi.hoisted(() => ({
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetApi: vi.fn(),
  mockListProductsApi: vi.fn(),
  mockUpdateApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./api", () => ({
  apiClient: {
    paymentSettings: {
      getTenantStorePaymentSettings: mockGetApi,
      listTenantStoreProducts: mockListProductsApi,
      updateTenantStorePaymentSettings: mockUpdateApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

// AppPurchaseRoute.STORE and AppPurchaseRoute.EXTERNAL_CHECKOUT.
const ROUTE_STORE = 2;
const ROUTE_EXTERNAL_CHECKOUT = 1;

const leakedPrivateKey = "leak-private-key-value";

const rpcSettings = {
  appPurchaseRoute: ROUTE_STORE,
  appStore: {
    bundleIdentifier: "com.example.reader",
    enabled: true,
    issuerId: "57246542-96fe-1a63-e053-0824d011072a",
    keyId: "2X9R4HXF34",
    privateKeyConfigured: true,
    privateKeyHint: "••••••••wIBAQQg",
    ready: true,
  },
  googlePlay: {
    enabled: false,
    packageName: "",
    ready: false,
    serviceAccountEmail: "",
    serviceAccountKeyConfigured: false,
    serviceAccountKeyHint: "",
  },
};

const screenSettings = {
  appPurchaseRoute: "store",
  appStore: rpcSettings.appStore,
  googlePlay: rpcSettings.googlePlay,
};

const updateInput = {
  appPurchaseRoute: "store",
  appStore: {
    enabled: true,
    issuerId: "57246542-96fe-1a63-e053-0824d011072a",
    keyId: "2X9R4HXF34",
    privateKey: { mode: 2, value: leakedPrivateKey },
  },
  googlePlay: { enabled: false, serviceAccountKey: { mode: 1, value: "" } },
  tenantId: "TENANT001",
} as const;

const fieldViolation = (...fields: string[]) =>
  new ConnectError("rejected", Code.InvalidArgument, undefined, [
    {
      desc: BadRequestSchema,
      value: { fieldViolations: fields.map((field) => ({ field })) },
    },
  ]);

describe("store-payment-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("reads both stores and the route under the tenant's tag", async () => {
    mockGetApi.mockResolvedValueOnce({ settings: rpcSettings });

    const { getTenantStorePaymentSettings } =
      await import("./store-payment-settings");
    const result = await getTenantStorePaymentSettings("TENANT001", "en");

    expect(result).toEqual({ ok: true, settings: screenSettings });
    expect(mockGetApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:store-payment-settings"
    );
  });

  it("keeps a key in the response out of the settings meant for the screen", async () => {
    mockGetApi.mockResolvedValueOnce({
      settings: {
        ...rpcSettings,
        appPurchaseRoute: ROUTE_EXTERNAL_CHECKOUT,
        appStore: { ...rpcSettings.appStore, privateKey: leakedPrivateKey },
      },
    });

    const { getTenantStorePaymentSettings } =
      await import("./store-payment-settings");
    const result = await getTenantStorePaymentSettings("TENANT001", "en");

    expect(JSON.stringify(result)).not.toContain(leakedPrivateKey);
    expect(result.ok && result.settings.appPurchaseRoute).toBe(
      "external_checkout"
    );
  });

  it("asks for a sign-in without a session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantStorePaymentSettings } =
      await import("./store-payment-settings");
    const result = await getTenantStorePaymentSettings("TENANT001", "en");

    expect(result).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetApi).not.toHaveBeenCalled();
  });

  it("sends the route as the enum and each key with its mode", async () => {
    mockUpdateApi.mockResolvedValueOnce({ settings: rpcSettings });

    const { updateTenantStorePaymentSettings } =
      await import("./store-payment-settings");
    const result = await updateTenantStorePaymentSettings(updateInput, "en");

    expect(result).toEqual({ ok: true, settings: screenSettings });
    expect(JSON.stringify(result)).not.toContain(leakedPrivateKey);
    expect(mockUpdateApi).toHaveBeenCalledWith(
      {
        appPurchaseRoute: ROUTE_STORE,
        appStore: {
          enabled: true,
          issuerId: "57246542-96fe-1a63-e053-0824d011072a",
          keyId: "2X9R4HXF34",
          privateKey: leakedPrivateKey,
          privateKeyUpdateMode: 2,
        },
        googlePlay: {
          enabled: false,
          serviceAccountKey: "",
          serviceAccountKeyUpdateMode: 1,
        },
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("names each field the API refused in the form's words", async () => {
    mockUpdateApi.mockRejectedValueOnce(
      fieldViolation(
        "app_store.issuer_id",
        "app_store.key_id",
        "app_store.private_key",
        "google_play.service_account_key"
      )
    );

    const { updateTenantStorePaymentSettings } =
      await import("./store-payment-settings");
    const result = await updateTenantStorePaymentSettings(updateInput, "en");

    expect(result).toEqual({
      fieldErrors: {
        issuerId: "Enter the issuer ID as App Store Connect shows it, a UUID.",
        keyId:
          "Enter the key ID as App Store Connect shows it, ten capital letters and digits.",
        privateKey:
          "The private key is not the .p8 file App Store Connect issues.",
        serviceAccountKey:
          "The key is not the JSON key file of a service account.",
      },
      message: "Please check the information you entered.",
      ok: false,
    });
  });

  it("puts the store route's refusal on the route", async () => {
    mockUpdateApi.mockRejectedValueOnce(
      new ConnectError(
        "selling through the store requires an enabled store with its key and its app",
        Code.FailedPrecondition
      )
    );

    const { updateTenantStorePaymentSettings } =
      await import("./store-payment-settings");
    const result = await updateTenantStorePaymentSettings(updateInput, "en");

    expect(result).toEqual({
      fieldErrors: {
        appPurchaseRoute:
          "The app can sell through the store only once the App Store or Google Play is ready: turned on, with its key, and with its app named under App links.",
      },
      message: "Please check the information you entered.",
      ok: false,
    });
  });

  it("does not swallow an error it cannot classify", async () => {
    mockUpdateApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { updateTenantStorePaymentSettings } =
      await import("./store-payment-settings");

    await expect(
      updateTenantStorePaymentSettings(updateInput, "en")
    ).rejects.toThrow(/boom/u);
  });

  it("lists the store products the catalog needs", async () => {
    mockListProductsApi.mockResolvedValueOnce({
      products: [
        { episodeCount: 2, price: 300, productId: "episode_300" },
        { episodeCount: 1, price: 500, productId: "episode_500" },
      ],
    });

    const { listTenantStoreProducts } =
      await import("./store-payment-settings");
    const result = await listTenantStoreProducts("TENANT001", "en");

    expect(result).toEqual({
      ok: true,
      products: [
        { episodeCount: 2, price: 300, productId: "episode_300" },
        { episodeCount: 1, price: 500, productId: "episode_500" },
      ],
    });
    expect(mockListProductsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("reports a refused product list as a message", async () => {
    mockListProductsApi.mockRejectedValueOnce(
      new ConnectError("admin role required", Code.PermissionDenied)
    );

    const { listTenantStoreProducts } =
      await import("./store-payment-settings");
    const result = await listTenantStoreProducts("TENANT001", "en");

    expect(result).toEqual({
      message:
        "You do not have permission to perform this action. Go back or use an account that does.",
      ok: false,
      requiresSignIn: false,
    });
  });
});
