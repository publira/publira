import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
} from "./email-settings-shared";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantInboundEmailSettingsApi,
  mockListInboundEmailProvidersApi,
  mockUpdateTenantInboundEmailSettingsApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantInboundEmailSettingsApi: vi.fn(),
  mockListInboundEmailProvidersApi: vi.fn(),
  mockUpdateTenantInboundEmailSettingsApi: vi.fn(),
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
    inboundEmailSettings: {
      getTenantInboundEmailSettings: mockGetTenantInboundEmailSettingsApi,
      listInboundEmailProviders: mockListInboundEmailProvidersApi,
      updateTenantInboundEmailSettings: mockUpdateTenantInboundEmailSettingsApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

const publicSettings = {
  domain: "reply.comics.example",
  enabled: true,
  fields: [
    { configured: true, hint: "re_••••••••KLMN", name: "api_key" },
    { configured: true, hint: "whsec_••••••••WXYZ", name: "webhook_secret" },
  ],
  provider: "resend",
  ready: true,
};

const rpcProviders = [
  {
    displayName: "Resend",
    fields: [
      { name: "api_key", required: true, secret: true },
      { name: "webhook_secret", required: true, secret: true },
    ],
    id: "resend",
    webhookPath: "/api/v1/webhook/email/resend",
  },
  {
    displayName: "SendGrid",
    fields: [{ name: "webhook_token", required: true, secret: true }],
    id: "sendgrid",
    webhookPath: "/api/v1/webhook/email/sendgrid",
  },
];

const leakedApiKey = "re_leaked_api_key_value";

const updateInput = {
  domain: "reply.comics.example",
  enabled: true,
  fields: [
    { mode: SECRET_UPDATE_MODE_REPLACE, name: "api_key", value: leakedApiKey },
    { mode: SECRET_UPDATE_MODE_UNCHANGED, name: "webhook_secret", value: "" },
  ],
  provider: "resend",
  tenantId: "TENANT001",
};

describe("inbound-email-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("reads the settings the screen may show under the tenant's tag", async () => {
    mockGetTenantInboundEmailSettingsApi.mockResolvedValueOnce({
      settings: {
        ...publicSettings,
        fields: publicSettings.fields.map((field) => ({
          ...field,
          value: leakedApiKey,
        })),
      },
    });

    const { getTenantInboundEmailSettings } =
      await import("./inbound-email-settings");

    const result = await getTenantInboundEmailSettings("TENANT001", "en");

    expect(result).toEqual({ ok: true, settings: publicSettings });
    expect(JSON.stringify(result)).not.toContain(leakedApiKey);
    expect(mockGetTenantInboundEmailSettingsApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:inbound-email-settings"
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("reads a tenant that has saved nothing as the empty settings", async () => {
    mockGetTenantInboundEmailSettingsApi.mockResolvedValueOnce({
      settings: {
        domain: "",
        enabled: false,
        fields: [],
        provider: "",
        ready: false,
      },
    });

    const { emptyTenantInboundEmailSettings, getTenantInboundEmailSettings } =
      await import("./inbound-email-settings");

    const result = await getTenantInboundEmailSettings("TENANT001", "en");

    expect(result).toEqual({
      ok: true,
      settings: emptyTenantInboundEmailSettings,
    });
  });

  it("asks for a sign-in without a session and caches nothing", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantInboundEmailSettings } =
      await import("./inbound-email-settings");

    const result = await getTenantInboundEmailSettings("TENANT001", "en");

    expect(result).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantInboundEmailSettingsApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  // The cache fill itself must not throw, or the request fails before any
  // boundary can render; the exported read throws once outside the scope.
  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockGetTenantInboundEmailSettingsApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );
    mockListInboundEmailProvidersApi.mockRejectedValueOnce(
      new TypeError("not an RPC error")
    );

    const { getTenantInboundEmailSettings, listInboundEmailProviders } =
      await import("./inbound-email-settings");

    await expect(
      getTenantInboundEmailSettings("TENANT001", "en")
    ).rejects.toThrow(Error);
    await expect(listInboundEmailProviders("TENANT001", "en")).rejects.toThrow(
      Error
    );
    expect(mockCacheLife).toHaveBeenCalledTimes(2);
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports an unreachable API as a message rather than throwing", async () => {
    mockGetTenantInboundEmailSettingsApi.mockRejectedValueOnce(
      new ConnectError("connection refused", Code.Unavailable)
    );

    const { getTenantInboundEmailSettings } =
      await import("./inbound-email-settings");

    const result = await getTenantInboundEmailSettings("TENANT001", "en");

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("unexpected");
  });

  it("lists the registered providers with the fields each declares", async () => {
    mockListInboundEmailProvidersApi.mockResolvedValueOnce({
      providers: rpcProviders,
    });

    const { listInboundEmailProviders } =
      await import("./inbound-email-settings");

    const result = await listInboundEmailProviders("TENANT001", "en");

    expect(result).toEqual({ ok: true, providers: rpcProviders });
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:inbound-email-settings"
    );
  });

  it("answers the declaration of a registered provider and refuses another", async () => {
    mockListInboundEmailProvidersApi.mockResolvedValue({
      providers: rpcProviders,
    });

    const { getInboundEmailProvider } =
      await import("./inbound-email-settings");

    expect(
      await getInboundEmailProvider("TENANT001", "sendgrid", "en")
    ).toEqual({ ok: true, provider: rpcProviders[1] });
    expect(await getInboundEmailProvider("TENANT001", "mailgun", "en")).toEqual(
      { message: "Choose an inbound email provider.", ok: false }
    );
  });

  it("sends the update and answers the public view without the plaintext", async () => {
    mockUpdateTenantInboundEmailSettingsApi.mockResolvedValueOnce({
      settings: publicSettings,
    });

    const { updateTenantInboundEmailSettings } =
      await import("./inbound-email-settings");

    const result = await updateTenantInboundEmailSettings(updateInput, "en");

    expect(result).toEqual({ ok: true, settings: publicSettings });
    expect(JSON.stringify(result)).not.toContain(leakedApiKey);
    expect(mockUpdateTenantInboundEmailSettingsApi).toHaveBeenCalledWith(
      {
        domain: "reply.comics.example",
        enabled: true,
        fields: updateInput.fields,
        provider: "resend",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("marks the server's refusal of the domain so the form can put it on the field", async () => {
    mockUpdateTenantInboundEmailSettingsApi.mockRejectedValueOnce(
      new ConnectError(
        "inbound domain is not a valid domain name",
        Code.InvalidArgument,
        undefined,
        [
          {
            desc: BadRequestSchema,
            value: { fieldViolations: [{ field: "domain" }] },
          },
        ]
      )
    );

    const { updateTenantInboundEmailSettings } =
      await import("./inbound-email-settings");

    const result = await updateTenantInboundEmailSettings(updateInput, "en");

    expect(result).toEqual({
      domainInvalid: true,
      message: expect.any(String),
      ok: false,
    });
  });

  it("passes any other refusal of the update through as the server words it", async () => {
    mockUpdateTenantInboundEmailSettingsApi.mockRejectedValueOnce(
      new ConnectError(
        "inbound email secret encryption is not configured",
        Code.FailedPrecondition
      )
    );

    const { updateTenantInboundEmailSettings } =
      await import("./inbound-email-settings");

    const result = await updateTenantInboundEmailSettings(updateInput, "en");

    expect(result).toEqual({
      message: "inbound email secret encryption is not configured",
      ok: false,
    });
  });
});
