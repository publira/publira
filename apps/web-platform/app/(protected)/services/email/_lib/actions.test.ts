import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetPlatformLocale,
  mockResolveAccessToken,
  mockSendPlatformSmtpTestEmail,
  mockUpdatePlatformEmailSettings,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockSendPlatformSmtpTestEmail: vi.fn(),
  mockUpdatePlatformEmailSettings: vi.fn(),
  mockUpdateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  updateTag: mockUpdateTag,
}));

vi.mock("#lib/audit-logs", () => ({
  platformAuditLogsCacheTag: "platform:audit-logs",
}));

vi.mock("#lib/csrf", () => ({ assertSameOrigin: mockAssertSameOrigin }));

vi.mock("#lib/api-client", () => ({
  resolveAccessToken: mockResolveAccessToken,
}));

vi.mock("#lib/email-settings", () => ({
  platformEmailSettingsCacheTag: "platform:email-settings",
  sendPlatformSmtpTestEmail: mockSendPlatformSmtpTestEmail,
  updatePlatformEmailSettings: mockUpdatePlatformEmailSettings,
}));

vi.mock("#lib/locale", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    getPlatformLocale: mockGetPlatformLocale,
  };
});

const smtpFormData = (): FormData => {
  const formData = new FormData();
  formData.set("encryption", "starttls");
  formData.set("host", "smtp.example.com");
  formData.set("port", "587");
  formData.set("revision", "3");
  return formData;
};

describe("SMTP settings actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockResolveAccessToken.mockResolvedValue("session-token");
    mockGetPlatformLocale.mockResolvedValue("en");
  });

  it("clears the SMTP settings and the audit log once a save succeeds", async () => {
    mockUpdatePlatformEmailSettings.mockResolvedValueOnce({
      ok: true,
      settings: {},
    });

    const { updatePlatformEmailSettingsAction } = await import("./actions");

    await expect(
      updatePlatformEmailSettingsAction(null, smtpFormData())
    ).resolves.toMatchObject({ ok: true });
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:email-settings");
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:audit-logs");
  });

  it("saves against the revision the form was rendered at", async () => {
    mockUpdatePlatformEmailSettings.mockResolvedValueOnce({
      ok: true,
      settings: {},
    });

    const { updatePlatformEmailSettingsAction } = await import("./actions");

    await updatePlatformEmailSettingsAction(null, smtpFormData());

    expect(mockUpdatePlatformEmailSettings).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 3n })
    );
  });

  it("refuses a save that does not state a revision without calling the API", async () => {
    const formData = smtpFormData();
    formData.delete("revision");

    const { updatePlatformEmailSettingsAction } = await import("./actions");

    await expect(
      updatePlatformEmailSettingsAction(null, formData)
    ).resolves.toMatchObject({ ok: false });
    expect(mockUpdatePlatformEmailSettings).not.toHaveBeenCalled();
  });

  it("clears nothing when the save fails", async () => {
    mockUpdatePlatformEmailSettings.mockResolvedValueOnce({
      message: "Could not save the settings.",
      ok: false,
    });

    const { updatePlatformEmailSettingsAction } = await import("./actions");

    await updatePlatformEmailSettingsAction(null, smtpFormData());

    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("clears the audit log after a failed test send, which the API records too", async () => {
    mockSendPlatformSmtpTestEmail.mockResolvedValueOnce({
      message: "Could not send the test email.",
      ok: false,
    });

    const { sendPlatformSmtpTestEmailAction } = await import("./actions");

    await sendPlatformSmtpTestEmailAction(null, smtpFormData());

    expect(mockUpdateTag).toHaveBeenCalledWith("platform:audit-logs");
    expect(mockUpdateTag).not.toHaveBeenCalledWith("platform:email-settings");
  });
});
