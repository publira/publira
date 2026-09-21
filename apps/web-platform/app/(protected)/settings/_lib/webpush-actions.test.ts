import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetPlatformLocale,
  mockResolveAccessToken,
  mockUpdatePlatformWebPushSubject,
  mockUpdateTag,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetPlatformLocale: vi.fn(),
  mockResolveAccessToken: vi.fn(),
  mockUpdatePlatformWebPushSubject: vi.fn(),
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

vi.mock("#lib/locale", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    getPlatformLocale: mockGetPlatformLocale,
  };
});

vi.mock("#lib/webpush-settings", () => ({
  platformWebPushSettingsCacheTag: "platform:webpush-settings",
  updatePlatformWebPushSubject: mockUpdatePlatformWebPushSubject,
}));

const subjectFormData = (subject: string): FormData => {
  const formData = new FormData();
  formData.set("revision", "3");
  formData.set("subject", subject);
  return formData;
};

describe("updatePlatformWebPushSubjectAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // `withPlatformSessionReauth` resolves the session before the mutation
    // runs; without a token the Action would redirect to /login.
    mockResolveAccessToken.mockResolvedValue("session-token");
    mockGetPlatformLocale.mockResolvedValue("en");
  });

  it("saves the subject at the rendered revision and clears the settings and the audit log", async () => {
    mockUpdatePlatformWebPushSubject.mockResolvedValueOnce({
      ok: true,
      settings: {
        configured: true,
        revision: "4",
        subject: "mailto:push@example.com",
      },
    });

    const { updatePlatformWebPushSubjectAction } =
      await import("./webpush-actions");

    await expect(
      updatePlatformWebPushSubjectAction(
        null,
        subjectFormData(" mailto:push@example.com ")
      )
    ).resolves.toEqual({ message: "Web Push settings saved.", ok: true });
    expect(mockUpdatePlatformWebPushSubject).toHaveBeenCalledWith(
      "mailto:push@example.com",
      3n,
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:webpush-settings");
    expect(mockUpdateTag).toHaveBeenCalledWith("platform:audit-logs");
  });

  it("refuses a subject that is neither form without a round trip", async () => {
    const { updatePlatformWebPushSubjectAction } =
      await import("./webpush-actions");

    const result = await updatePlatformWebPushSubjectAction(
      null,
      subjectFormData("push@example.com")
    );

    expect(result).toMatchObject({ ok: false });
    expect(result?.message).toMatch(/^Enter a mailto: URI/u);
    expect(mockUpdatePlatformWebPushSubject).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("clears nothing when the API refuses the save", async () => {
    mockUpdatePlatformWebPushSubject.mockResolvedValueOnce({
      message: "Another operator changed the Web Push settings.",
      ok: false,
    });

    const { updatePlatformWebPushSubjectAction } =
      await import("./webpush-actions");

    await expect(
      updatePlatformWebPushSubjectAction(
        null,
        subjectFormData("https://example.com/contact")
      )
    ).resolves.toEqual({
      message: "Another operator changed the Web Push settings.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
