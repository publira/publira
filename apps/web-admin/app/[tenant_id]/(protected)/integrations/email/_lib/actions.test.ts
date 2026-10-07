import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetAccessToken,
  mockGetInboundEmailProvider,
  mockUpdateTag,
  mockUpdateTenantEmailSettings,
  mockUpdateTenantInboundEmailSettings,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetInboundEmailProvider: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUpdateTenantEmailSettings: vi.fn(),
  mockUpdateTenantInboundEmailSettings: vi.fn(),
}));

vi.mock("#lib/action-messages", async () => {
  const { bindMessages } = await import("@publira/i18n");
  const { sharedCatalog } = await import("@publira/i18n/catalog");
  return {
    getActionLocale: () => Promise.resolve("en"),
    getActionMessages: () =>
      Promise.resolve(bindMessages(sharedCatalog("en"), "en")),
  };
});

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/email-settings", () => ({
  sendTenantSmtpTestEmail: vi.fn(),
  tenantEmailSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:email-settings`,
  updateTenantEmailSettings: mockUpdateTenantEmailSettings,
}));

vi.mock("#lib/inbound-email-settings", () => ({
  getInboundEmailProvider: mockGetInboundEmailProvider,
  tenantInboundEmailSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:inbound-email-settings`,
  updateTenantInboundEmailSettings: mockUpdateTenantInboundEmailSettings,
}));

const textFormData = (values: Record<string, string>): FormData => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }
  return formData;
};

const smtpFormData = (): FormData =>
  textFormData({
    encryption: "starttls",
    from_address: "noreply@example.com",
    from_name: "Publira",
    host: "smtp.example.com",
    port: "587",
    smtp_override_enabled: "on",
    tenant_id: "TENANT001",
    username: "mailer",
  });

describe("updateTenantEmailSettingsAction", () => {
  const savedSmtpSettings = {
    encryption: "starttls",
    fromAddress: "noreply@example.com",
    fromName: "Publira",
    hasPassword: true,
    host: "smtp.example.com",
    port: 587,
    replyTo: "",
    smtpOverrideEnabled: true,
    username: "mailer",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("clears the email settings tag so the saved SMTP host is on the screen at once", async () => {
    mockUpdateTenantEmailSettings.mockResolvedValueOnce({
      ok: true,
      settings: savedSmtpSettings,
    });

    const { updateTenantEmailSettingsAction } = await import("./actions");

    const result = await updateTenantEmailSettingsAction(null, smtpFormData());

    expect(result).toEqual({
      message: "The email settings were saved.",
      ok: true,
      settings: savedSmtpSettings,
    });
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:email-settings"
    );
  });

  it("leaves the cache alone when the save fails", async () => {
    mockUpdateTenantEmailSettings.mockResolvedValueOnce({
      message: "Could not save the email settings.",
      ok: false,
    });

    const { updateTenantEmailSettingsAction } = await import("./actions");

    await updateTenantEmailSettingsAction(null, smtpFormData());

    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

const resend = {
  displayName: "Resend",
  fields: [
    { name: "api_key", required: true, secret: true },
    { name: "webhook_secret", required: true, secret: true },
  ],
  id: "resend",
  webhookPath: "/api/v1/webhook/email/resend",
};

const storedInboundSettings = {
  domain: "reply.comics.example",
  enabled: true,
  fields: [
    { configured: true, hint: "re_••••••••KLMN", name: "api_key" },
    { configured: true, hint: "whsec_••••••••WXYZ", name: "webhook_secret" },
  ],
  provider: "resend",
  ready: true,
};

const inboundFormData = (values: Record<string, string> = {}): FormData =>
  textFormData({
    credential_api_key: "re_NEW",
    credential_api_key_mode: "replace",
    credential_webhook_secret: "whsec_NEW",
    credential_webhook_secret_mode: "replace",
    domain: "reply.comics.example",
    enabled: "on",
    provider: "resend",
    tenant_id: "TENANT001",
    ...values,
  });

describe("updateTenantInboundEmailSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
    mockGetInboundEmailProvider.mockImplementation(
      (_tenantId: string, providerId: string) =>
        Promise.resolve(
          providerId === resend.id
            ? { ok: true, provider: resend }
            : { message: "Choose an inbound email provider.", ok: false }
        )
    );
  });

  it("saves the provider, the domain, and the credentials, then clears the tag", async () => {
    mockUpdateTenantInboundEmailSettings.mockResolvedValueOnce({
      ok: true,
      settings: storedInboundSettings,
    });

    const { updateTenantInboundEmailSettingsAction } =
      await import("./actions");

    const result = await updateTenantInboundEmailSettingsAction(
      null,
      inboundFormData({ domain: "  reply.comics.example  " })
    );

    expect(result).toEqual({
      message: "The inbound email settings were saved.",
      ok: true,
    });
    expect(mockUpdateTenantInboundEmailSettings).toHaveBeenCalledWith(
      {
        domain: "reply.comics.example",
        enabled: true,
        fields: [
          { mode: 2, name: "api_key", value: "re_NEW" },
          { mode: 2, name: "webhook_secret", value: "whsec_NEW" },
        ],
        provider: "resend",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:inbound-email-settings"
    );
  });

  it("turns inbound email off without a domain or credentials", async () => {
    mockUpdateTenantInboundEmailSettings.mockResolvedValueOnce({
      ok: true,
      settings: { ...storedInboundSettings, enabled: false, ready: false },
    });

    const { updateTenantInboundEmailSettingsAction } =
      await import("./actions");

    const result = await updateTenantInboundEmailSettingsAction(
      null,
      textFormData({
        credential_api_key_mode: "replace",
        credential_webhook_secret_mode: "replace",
        domain: "",
        provider: "resend",
        tenant_id: "TENANT001",
      })
    );

    expect(result?.ok).toBe(true);
    expect(mockUpdateTenantInboundEmailSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: "",
        enabled: false,
        fields: [
          { mode: 1, name: "api_key", value: "" },
          { mode: 1, name: "webhook_secret", value: "" },
        ],
      }),
      "en"
    );
  });

  it("asks for the domain and every required credential before turning it on", async () => {
    const { updateTenantInboundEmailSettingsAction } =
      await import("./actions");

    const withoutDomain = await updateTenantInboundEmailSettingsAction(
      null,
      inboundFormData({ domain: "" })
    );

    expect(withoutDomain).toEqual({
      fieldErrors: {
        domain: "Enter the inbound domain to turn inbound email on.",
      },
      message: expect.any(String),
      ok: false,
    });

    const withoutSecret = await updateTenantInboundEmailSettingsAction(
      null,
      inboundFormData({
        credential_webhook_secret: "",
        credential_webhook_secret_configured: "0",
      })
    );

    expect(withoutSecret).toEqual({
      fieldErrors: {
        credential_webhook_secret: "Enter this value to turn inbound email on.",
      },
      message: expect.any(String),
      ok: false,
    });
    expect(mockUpdateTenantInboundEmailSettings).not.toHaveBeenCalled();
  });

  it("refuses a provider the server does not register", async () => {
    const { updateTenantInboundEmailSettingsAction } =
      await import("./actions");

    const result = await updateTenantInboundEmailSettingsAction(
      null,
      inboundFormData({ provider: "mailgun" })
    );

    expect(result).toEqual({
      message: "Choose an inbound email provider.",
      ok: false,
    });
    expect(mockUpdateTenantInboundEmailSettings).not.toHaveBeenCalled();
  });

  it("puts the server's refusal of the domain on the domain field", async () => {
    mockUpdateTenantInboundEmailSettings.mockResolvedValueOnce({
      domainInvalid: true,
      message: "Check the highlighted fields.",
      ok: false,
    });

    const { updateTenantInboundEmailSettingsAction } =
      await import("./actions");

    const result = await updateTenantInboundEmailSettingsAction(
      null,
      inboundFormData({ domain: "not a domain" })
    );

    expect(result).toEqual({
      fieldErrors: {
        domain: "Enter a domain name such as reply.example.com.",
      },
      message: "Check the highlighted fields.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
