import { Code, ConnectError } from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
} from "./email-settings-shared";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantPaymentSettingsApi,
  mockListPaymentProvidersApi,
  mockUpdateTenantPaymentSettingsApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantPaymentSettingsApi: vi.fn(),
  mockListPaymentProvidersApi: vi.fn(),
  mockUpdateTenantPaymentSettingsApi: vi.fn(),
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
    paymentSettings: {
      getTenantPaymentSettings: mockGetTenantPaymentSettingsApi,
      listPaymentProviders: mockListPaymentProvidersApi,
      updateTenantPaymentSettings: mockUpdateTenantPaymentSettingsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const rpcSettings = {
  enabled: true,
  fields: [
    {
      configured: true,
      hint: "sk_test_••••••••KLMN",
      name: "secret_key",
      publicValue: "",
    },
    {
      configured: true,
      hint: "whsec_••••••••WXYZ",
      name: "webhook_secret",
      publicValue: "",
    },
  ],
  provider: "stripe",
  ready: true,
};

const publicSettings = {
  enabled: true,
  fields: [
    { configured: true, hint: "sk_test_••••••••KLMN", name: "secret_key" },
    { configured: true, hint: "whsec_••••••••WXYZ", name: "webhook_secret" },
  ],
  provider: "stripe",
  ready: true,
};

const rpcProviders = [
  {
    displayName: "Example Pay",
    fields: [
      { name: "secret_key", public: false, required: true, secret: true },
      { name: "public_key", public: true, required: true, secret: false },
      { name: "webhook_token", public: false, required: false, secret: true },
    ],
    id: "examplepay",
    webhookPath: "/api/v1/webhook/payment/examplepay",
  },
  {
    displayName: "Stripe",
    fields: [
      { name: "secret_key", public: false, required: true, secret: true },
      { name: "webhook_secret", public: false, required: true, secret: true },
    ],
    id: "stripe",
    webhookPath: "/api/v1/webhook/payment/stripe",
  },
];

const leakedSecretKey = "leak-secret-key-value";
const leakedWebhookSecret = "leak-webhook-secret-value";

describe("payment-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns only the settings that may be exposed on a successful fetch", async () => {
    mockGetTenantPaymentSettingsApi.mockResolvedValueOnce({
      settings: rpcSettings,
    });

    const { getTenantPaymentSettings } = await import("./payment-settings");

    const result = await getTenantPaymentSettings("TENANT001", "en");

    expect(result).toEqual({ ok: true, settings: publicSettings });
    expect(mockGetTenantPaymentSettingsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:payment-settings"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("keeps a plaintext secret in the response out of the settings meant for the screen", async () => {
    mockGetTenantPaymentSettingsApi.mockResolvedValueOnce({
      settings: {
        ...rpcSettings,
        fields: rpcSettings.fields.map((field) => ({
          ...field,
          value:
            field.name === "secret_key" ? leakedSecretKey : leakedWebhookSecret,
        })),
        secretKey: leakedSecretKey,
        webhookSecret: leakedWebhookSecret,
      },
    });

    const { getTenantPaymentSettings } = await import("./payment-settings");

    const result = await getTenantPaymentSettings("TENANT001", "en");

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain(leakedSecretKey);
    expect(JSON.stringify(result)).not.toContain(leakedWebhookSecret);
    if (result.ok) {
      expect(result.settings.fields[0]).toEqual({
        configured: true,
        hint: "sk_test_••••••••KLMN",
        name: "secret_key",
      });
      expect(result.settings).not.toHaveProperty("secretKey");
      expect(result.settings).not.toHaveProperty("webhookSecret");
    }
  });

  it("reads a tenant that has saved nothing as no provider and no fields", async () => {
    mockGetTenantPaymentSettingsApi.mockResolvedValueOnce({
      settings: { enabled: false, fields: [], provider: "", ready: false },
    });

    const { emptyTenantPaymentSettings, getTenantPaymentSettings } =
      await import("./payment-settings");

    const result = await getTenantPaymentSettings("TENANT001", "en");

    expect(result).toEqual({ ok: true, settings: emptyTenantPaymentSettings });
  });

  it("returns an error when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantPaymentSettings } = await import("./payment-settings");

    const result = await getTenantPaymentSettings("TENANT001", "en");

    expect(result).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantPaymentSettingsApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("returns the shared permission error message without the permission", async () => {
    mockGetTenantPaymentSettingsApi.mockRejectedValueOnce(
      new ConnectError("admin role required", Code.PermissionDenied)
    );

    const { getTenantPaymentSettings } = await import("./payment-settings");

    const result = await getTenantPaymentSettings("TENANT001", "en");

    expect(result).toEqual({
      message:
        "You do not have permission to perform this action. Go back or use an account that does.",
      ok: false,
      requiresSignIn: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("does not swallow an error it cannot classify", async () => {
    mockGetTenantPaymentSettingsApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { getTenantPaymentSettings } = await import("./payment-settings");

    await expect(getTenantPaymentSettings("TENANT001", "en")).rejects.toThrow(
      /boom/u
    );
  });

  it("returns the public view and keeps no plaintext on a successful update", async () => {
    mockUpdateTenantPaymentSettingsApi.mockResolvedValueOnce({
      settings: rpcSettings,
    });

    const { updateTenantPaymentSettings } = await import("./payment-settings");

    const result = await updateTenantPaymentSettings(
      {
        enabled: true,
        fields: [
          {
            mode: SECRET_UPDATE_MODE_REPLACE,
            name: "secret_key",
            value: leakedSecretKey,
          },
          {
            mode: SECRET_UPDATE_MODE_REPLACE,
            name: "webhook_secret",
            value: leakedWebhookSecret,
          },
        ],
        provider: "stripe",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({ ok: true, settings: publicSettings });
    expect(JSON.stringify(result)).not.toContain(leakedSecretKey);
    expect(JSON.stringify(result)).not.toContain(leakedWebhookSecret);
    expect(mockUpdateTenantPaymentSettingsApi).toHaveBeenCalledWith(
      {
        enabled: true,
        fields: [
          {
            mode: SECRET_UPDATE_MODE_REPLACE,
            name: "secret_key",
            value: leakedSecretKey,
          },
          {
            mode: SECRET_UPDATE_MODE_REPLACE,
            name: "webhook_secret",
            value: leakedWebhookSecret,
          },
        ],
        provider: "stripe",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("returns the message of the server as it is for invalid_argument on an update", async () => {
    mockUpdateTenantPaymentSettingsApi.mockRejectedValueOnce(
      new ConnectError(
        "every required credential field must be stored when payment is enabled: secret_key, webhook_secret",
        Code.InvalidArgument
      )
    );

    const { updateTenantPaymentSettings } = await import("./payment-settings");

    const result = await updateTenantPaymentSettings(
      {
        enabled: true,
        fields: [
          { mode: SECRET_UPDATE_MODE_UNCHANGED, name: "secret_key", value: "" },
          {
            mode: SECRET_UPDATE_MODE_UNCHANGED,
            name: "webhook_secret",
            value: "",
          },
        ],
        provider: "stripe",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "every required credential field must be stored when payment is enabled: secret_key, webhook_secret",
      ok: false,
    });
  });

  it("returns the shared permission error message for an update without the permission", async () => {
    mockUpdateTenantPaymentSettingsApi.mockRejectedValueOnce(
      new ConnectError("admin role required", Code.PermissionDenied)
    );

    const { updateTenantPaymentSettings } = await import("./payment-settings");

    const result = await updateTenantPaymentSettings(
      {
        enabled: false,
        fields: [
          { mode: SECRET_UPDATE_MODE_UNCHANGED, name: "secret_key", value: "" },
          {
            mode: SECRET_UPDATE_MODE_UNCHANGED,
            name: "webhook_secret",
            value: "",
          },
        ],
        provider: "stripe",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "You do not have permission to perform this action. Go back or use an account that does.",
      ok: false,
    });
  });

  it("lists the registered providers with the fields each declares", async () => {
    mockListPaymentProvidersApi.mockResolvedValueOnce({
      providers: rpcProviders,
    });

    const { listPaymentProviders } = await import("./payment-settings");

    const result = await listPaymentProviders("TENANT001", "en");

    expect(result).toEqual({
      ok: true,
      providers: rpcProviders,
    });
    expect(mockListPaymentProvidersApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:payment-settings"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("reports a provider list the API refuses as a message", async () => {
    mockListPaymentProvidersApi.mockRejectedValueOnce(
      new ConnectError("admin role required", Code.PermissionDenied)
    );

    const { listPaymentProviders } = await import("./payment-settings");

    const result = await listPaymentProviders("TENANT001", "en");

    expect(result).toEqual({
      message:
        "You do not have permission to perform this action. Go back or use an account that does.",
      ok: false,
      requiresSignIn: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("asks for a sign-in before listing providers without a session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { listPaymentProviders } = await import("./payment-settings");

    const result = await listPaymentProviders("TENANT001", "en");

    expect(result).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockListPaymentProvidersApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("finds the declaration of the provider a save names", async () => {
    mockListPaymentProvidersApi.mockResolvedValueOnce({
      providers: rpcProviders,
    });

    const { getPaymentProvider } = await import("./payment-settings");

    const result = await getPaymentProvider("TENANT001", "examplepay", "en");

    expect(result).toEqual({ ok: true, provider: rpcProviders[0] });
  });

  it("refuses a provider the server does not register", async () => {
    mockListPaymentProvidersApi.mockResolvedValueOnce({
      providers: rpcProviders,
    });

    const { getPaymentProvider } = await import("./payment-settings");

    const result = await getPaymentProvider("TENANT001", "unknown", "en");

    expect(result).toEqual({
      message: "Choose a payment provider.",
      ok: false,
    });
  });

  it("tenantPaymentSettingsCacheTag normalizes the tenant id", async () => {
    const { tenantPaymentSettingsCacheTag } =
      await import("./payment-settings");

    expect(tenantPaymentSettingsCacheTag("  TENANT001 ")).toBe(
      "tenant:TENANT001:payment-settings"
    );
  });
});
