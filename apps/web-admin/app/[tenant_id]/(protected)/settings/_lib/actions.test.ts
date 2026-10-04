import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetAccessToken,
  mockUpdateTag,
  mockUpdateTenantDefaultLocale,
  mockUpdateTenantEmailRejectionSettings,
  mockUpdateTenantLegalPages,
  mockUpdateTenantSiteSettings,
  mockUpdateTenantTimezone,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUpdateTenantDefaultLocale: vi.fn(),
  mockUpdateTenantEmailRejectionSettings: vi.fn(),
  mockUpdateTenantLegalPages: vi.fn(),
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

vi.mock("#lib/public-api", () => ({
  tenantSiteCacheTag: (tenantId: string) => `tenant:${tenantId}:site`,
}));

vi.mock("#lib/site-settings", () => ({
  tenantSiteSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:site-settings`,
  updateTenantSiteSettings: mockUpdateTenantSiteSettings,
}));

vi.mock("#lib/tenant-default-locale", () => ({
  updateTenantDefaultLocale: mockUpdateTenantDefaultLocale,
}));

vi.mock("#lib/tenant-email-rejection-settings", () => ({
  tenantEmailRejectionSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:email-rejection-settings`,
  updateTenantEmailRejectionSettings: mockUpdateTenantEmailRejectionSettings,
}));

vi.mock("#lib/tenant-legal-pages", () => ({
  tenantLegalPagesCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:legal-pages`,
  updateTenantLegalPages: mockUpdateTenantLegalPages,
}));

vi.mock("#lib/tenant-timezone", () => ({
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
    });
    expect(mockUpdateTenantTimezone).toHaveBeenCalledWith(
      {
        tenantId: "TENANT001",
        timezone: "America/Los_Angeles",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:site");
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
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:site");
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

describe("updateTenantLegalPagesAction", () => {
  const termsPageId = "0194d3c6-6c3e-7a4a-8d2e-2f6a1b0c9d01";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("writes both nominations, an empty one clearing its role, and revalidates the tag", async () => {
    mockUpdateTenantLegalPages.mockResolvedValueOnce({
      ok: true,
      pages: {},
    });

    const { updateTenantLegalPagesAction } = await import("./actions");

    const result = await updateTenantLegalPagesAction(
      null,
      textFormData({
        privacy_page_id: "",
        tenant_id: "TENANT001",
        terms_page_id: termsPageId,
      })
    );

    expect(result).toEqual({
      message: "The terms and privacy policy were saved.",
      ok: true,
    });
    expect(mockUpdateTenantLegalPages).toHaveBeenCalledWith(
      { privacyPageId: "", tenantId: "TENANT001", termsPageId },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:legal-pages");
  });

  it("refuses a value that is not a page id without calling the API", async () => {
    const { updateTenantLegalPagesAction } = await import("./actions");

    const result = await updateTenantLegalPagesAction(
      null,
      textFormData({
        privacy_page_id: "privacy",
        tenant_id: "TENANT001",
        terms_page_id: termsPageId,
      })
    );

    expect(result).toEqual({
      message: "Choose a page from the list.",
      ok: false,
    });
    expect(mockUpdateTenantLegalPages).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("returns the API's refusal without revalidating", async () => {
    mockUpdateTenantLegalPages.mockResolvedValueOnce({
      message:
        "The page chosen as the terms of service is not published. Reload the page and choose again.",
      ok: false,
    });

    const { updateTenantLegalPagesAction } = await import("./actions");

    const result = await updateTenantLegalPagesAction(
      null,
      textFormData({
        privacy_page_id: "",
        tenant_id: "TENANT001",
        terms_page_id: termsPageId,
      })
    );

    expect(result).toEqual({
      message:
        "The page chosen as the terms of service is not published. Reload the page and choose again.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

/** The card's form: the switch while it is on, and one `entries` field per input. */
const EMAIL_REJECTION_TENANT_ID = "018f1060-0001-7000-8000-000000000001";

const emailRejectionFormData = (
  entries: string[],
  rejectDisposableDomains?: string,
  tenantId: string = EMAIL_REJECTION_TENANT_ID
): FormData => {
  const formData = textFormData({ tenant_id: tenantId });
  for (const entry of entries) {
    formData.append("entries", entry);
  }
  if (rejectDisposableDomains !== undefined) {
    formData.set("reject_disposable_domains", rejectDisposableDomains);
  }
  return formData;
};

describe("updateTenantEmailRejectionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("sends the switch and each non-blank field, then revalidates the tag", async () => {
    const saved = {
      disposableDomainListAvailable: true,
      ok: true,
      settings: {
        entries: ["refused.example", "someone@example.com"],
        rejectDisposableDomains: true,
      },
    };
    mockUpdateTenantEmailRejectionSettings.mockResolvedValueOnce(saved);

    const { updateTenantEmailRejectionAction } = await import("./actions");

    const result = await updateTenantEmailRejectionAction(
      null,
      emailRejectionFormData(
        [" Refused.Example ", "", "someone@example.com"],
        "on"
      )
    );

    expect(result).toEqual({
      disposableDomainListAvailable: true,
      message: "The refused email addresses were saved.",
      ok: true,
      settings: saved.settings,
    });
    expect(mockUpdateTenantEmailRejectionSettings).toHaveBeenCalledWith(
      {
        entries: ["Refused.Example", "someone@example.com"],
        rejectDisposableDomains: true,
        tenantId: EMAIL_REJECTION_TENANT_ID,
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      `tenant:${EMAIL_REJECTION_TENANT_ID}:email-rejection-settings`
    );
  });

  it("reads an absent switch as off and empty fields as clearing the list", async () => {
    mockUpdateTenantEmailRejectionSettings.mockResolvedValueOnce({
      disposableDomainListAvailable: false,
      ok: true,
      settings: { entries: [], rejectDisposableDomains: false },
    });

    const { updateTenantEmailRejectionAction } = await import("./actions");

    await updateTenantEmailRejectionAction(null, emailRejectionFormData([""]));

    expect(mockUpdateTenantEmailRejectionSettings).toHaveBeenCalledWith(
      {
        entries: [],
        rejectDisposableDomains: false,
        tenantId: EMAIL_REJECTION_TENANT_ID,
      },
      "en"
    );
  });

  it("names the entry it refuses without calling the API", async () => {
    const { updateTenantEmailRejectionAction } = await import("./actions");

    const result = await updateTenantEmailRejectionAction(
      null,
      emailRejectionFormData(["refused.example", "not a domain"], "on")
    );

    const message = '"not a domain" is neither an email address nor a domain.';
    expect(result).toEqual({
      fieldErrors: { entries: message },
      message,
      ok: false,
    });
    expect(mockUpdateTenantEmailRejectionSettings).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", ""],
    ["not a tenant id", "TENANT001"],
  ])(
    "refuses a tenant id that is %s without calling the API",
    async (_, tenantId) => {
      const { updateTenantEmailRejectionAction } = await import("./actions");

      const result = await updateTenantEmailRejectionAction(
        null,
        emailRejectionFormData(["refused.example"], "on", tenantId)
      );

      expect(result?.ok).toBe(false);
      expect(mockUpdateTenantEmailRejectionSettings).not.toHaveBeenCalled();
    }
  );

  it("refuses a switch value a checkbox never submits", async () => {
    const { updateTenantEmailRejectionAction } = await import("./actions");

    const result = await updateTenantEmailRejectionAction(
      null,
      emailRejectionFormData([], "true")
    );

    expect(result?.ok).toBe(false);
    expect(mockUpdateTenantEmailRejectionSettings).not.toHaveBeenCalled();
  });

  it("puts the API's refusal of the list beside the field without revalidating", async () => {
    const message =
      "Check the list. Each entry must be one email address or domain, and at most 1000 can be listed.";
    mockUpdateTenantEmailRejectionSettings.mockResolvedValueOnce({
      entriesError: message,
      message,
      ok: false,
    });

    const { updateTenantEmailRejectionAction } = await import("./actions");

    const result = await updateTenantEmailRejectionAction(
      null,
      emailRejectionFormData(["xn--zz.com"])
    );

    expect(result).toEqual({
      fieldErrors: { entries: message },
      message,
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
