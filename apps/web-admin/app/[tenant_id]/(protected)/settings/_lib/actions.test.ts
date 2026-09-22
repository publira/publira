import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetAccessToken,
  mockUpdateTag,
  mockUpdateTenantDefaultLocale,
  mockUpdateTenantSiteSettings,
  mockUpdateTenantTimezone,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUpdateTenantDefaultLocale: vi.fn(),
  mockUpdateTenantSiteSettings: vi.fn(),
  mockUpdateTenantTimezone: vi.fn(),
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

vi.mock("#lib/admin-auth", () => ({
  requestAdminEmailChange: vi.fn(),
}));

vi.mock("#lib/site-settings", () => ({
  tenantSiteSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:site-settings`,
  updateTenantSiteSettings: mockUpdateTenantSiteSettings,
}));

vi.mock("#lib/tenant-default-locale", () => ({
  tenantDefaultLocaleCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:default-locale`,
  updateTenantDefaultLocale: mockUpdateTenantDefaultLocale,
}));

vi.mock("#lib/tenant-timezone", () => ({
  tenantTimezoneCacheTag: (tenantId: string) => `tenant:${tenantId}:timezone`,
  updateTenantTimezone: mockUpdateTenantTimezone,
}));

const textFormData = (values: Record<string, string>): FormData => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }
  return formData;
};

describe("updateTenantTimezoneAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // `withAdminSessionReauth` resolves the session before the mutation runs;
    // without a token every Action under test would redirect to /login.
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("saves a valid IANA name and revalidates the cache tag", async () => {
    mockUpdateTenantTimezone.mockResolvedValueOnce({
      ok: true,
      timezone: "America/Los_Angeles",
    });

    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      textFormData({
        tenant_id: "TENANT001",
        timezone: "America/Los_Angeles",
      })
    );

    expect(result).toEqual({
      message: "The time zone was saved.",
      ok: true,
      timezone: "America/Los_Angeles",
    });
    expect(mockUpdateTenantTimezone).toHaveBeenCalledWith(
      {
        tenantId: "TENANT001",
        timezone: "America/Los_Angeles",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:timezone");
  });

  it("saves an alias that is not enumerated just as the server does", async () => {
    mockUpdateTenantTimezone.mockResolvedValueOnce({
      ok: true,
      timezone: "Asia/Calcutta",
    });

    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      textFormData({ tenant_id: "TENANT001", timezone: "Asia/Calcutta" })
    );

    expect(result).toEqual({
      message: "The time zone was saved.",
      ok: true,
      timezone: "Asia/Calcutta",
    });
    expect(mockUpdateTenantTimezone).toHaveBeenCalledWith(
      {
        tenantId: "TENANT001",
        timezone: "Asia/Calcutta",
      },
      "en"
    );
  });

  it.each([
    { label: "an unknown IANA name", timezone: "Asia/Nowhere" },
    // Go's time.LoadLocation accepts `Local`, but it names the API process's
    // own zone rather than anything a tenant could be set to. An offset
    // notation is the mirror image: only Temporal accepts one.
    {
      label: "Local, which names the zone of the server process",
      timezone: "Local",
    },
    { label: "an offset notation", timezone: "+09:00" },
  ])("rejects $label without calling the API", async ({ timezone }) => {
    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      textFormData({ tenant_id: "TENANT001", timezone })
    );

    expect(result).toEqual({
      message: "Select a valid time zone.",
      ok: false,
    });
    expect(mockUpdateTenantTimezone).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("asks for a choice when the form is submitted with nothing selected", async () => {
    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      textFormData({ tenant_id: "TENANT001", timezone: "  " })
    );

    expect(result).toEqual({
      message: "Select a time zone.",
      ok: false,
    });
    expect(mockUpdateTenantTimezone).not.toHaveBeenCalled();
  });

  it("does not save when the tenant id is missing", async () => {
    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      textFormData({ timezone: "UTC" })
    );

    expect(result).toEqual({
      message: "The tenant ID is missing.",
      ok: false,
    });
    expect(mockUpdateTenantTimezone).not.toHaveBeenCalled();
  });

  it("returns the message and leaves the cache tag alone when the save fails", async () => {
    mockUpdateTenantTimezone.mockResolvedValueOnce({
      message: "You do not have permission.",
      ok: false,
    });

    const { updateTenantTimezoneAction } = await import("./actions");

    const result = await updateTenantTimezoneAction(
      null,
      textFormData({ tenant_id: "TENANT001", timezone: "UTC" })
    );

    expect(result).toEqual({
      message: "You do not have permission.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("updateTenantDefaultLocaleAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("saves the supported locale and revalidates the cache tag", async () => {
    mockUpdateTenantDefaultLocale.mockResolvedValueOnce({
      defaultLocale: "en",
      ok: true,
    });

    const { updateTenantDefaultLocaleAction } = await import("./actions");

    const result = await updateTenantDefaultLocaleAction(
      null,
      textFormData({
        default_locale: "en",
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({
      defaultLocale: "en",
      message: "The default language was saved.",
      ok: true,
    });
    expect(mockUpdateTenantDefaultLocale).toHaveBeenCalledWith(
      {
        defaultLocale: "en",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:default-locale"
    );
  });

  it.each([
    { label: "an unknown locale", locale: "fr" },
    { label: "an uppercase code", locale: "EN" },
    { label: "a BCP 47 tag", locale: "ja-JP" },
    { label: "an empty string", locale: "  " },
  ])("rejects $label without calling the API", async ({ locale }) => {
    const { updateTenantDefaultLocaleAction } = await import("./actions");

    const result = await updateTenantDefaultLocaleAction(
      null,
      textFormData({ default_locale: locale, tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      message: "Select a language.",
      ok: false,
    });
    expect(mockUpdateTenantDefaultLocale).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("does not save when the tenant id is missing", async () => {
    const { updateTenantDefaultLocaleAction } = await import("./actions");

    const result = await updateTenantDefaultLocaleAction(
      null,
      textFormData({ default_locale: "en" })
    );

    expect(result).toEqual({
      message: "The tenant ID is missing.",
      ok: false,
    });
    expect(mockUpdateTenantDefaultLocale).not.toHaveBeenCalled();
  });

  it("returns the message and leaves the cache tag alone when the save fails", async () => {
    mockUpdateTenantDefaultLocale.mockResolvedValueOnce({
      message: "You do not have permission.",
      ok: false,
    });

    const { updateTenantDefaultLocaleAction } = await import("./actions");

    const result = await updateTenantDefaultLocaleAction(
      null,
      textFormData({ default_locale: "en", tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      message: "You do not have permission.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("updateSiteSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("clears the site settings tag so the saved copy is on the screen at once", async () => {
    mockUpdateTenantSiteSettings.mockResolvedValueOnce({
      ok: true,
      settings: {
        copyrightText: "Copyright 2026 Acme Inc.",
        siteDescription: "A description",
        siteTagline: "A tagline",
      },
    });

    const { updateSiteSettingsAction } = await import("./actions");

    const result = await updateSiteSettingsAction(
      null,
      textFormData({
        copyright_text: "Copyright 2026 Acme Inc.",
        site_description: "A description",
        site_tagline: "A tagline",
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({
      message: "The settings were saved.",
      ok: true,
    });
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:site-settings"
    );
  });

  it("leaves the cache alone when the save fails", async () => {
    mockUpdateTenantSiteSettings.mockResolvedValueOnce({
      message: "Could not save the settings. Please try again later.",
      ok: false,
    });

    const { updateSiteSettingsAction } = await import("./actions");

    await updateSiteSettingsAction(
      null,
      textFormData({ site_tagline: "A tagline", tenant_id: "TENANT001" })
    );

    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
