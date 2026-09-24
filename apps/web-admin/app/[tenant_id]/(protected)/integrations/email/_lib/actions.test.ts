import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetAccessToken,
  mockUpdateTag,
  mockUpdateTenantEmailSettings,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUpdateTenantEmailSettings: vi.fn(),
}));

vi.mock("#lib/action-messages", async () => {
  const { bindMessages } = await import("@publira/i18n");
  const { sharedCatalog } = await import("@publira/i18n/catalog");
  return {
    getActionLocale: () => Promise.resolve("en"),
    getActionMessages: () => Promise.resolve(bindMessages(sharedCatalog("en"))),
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
