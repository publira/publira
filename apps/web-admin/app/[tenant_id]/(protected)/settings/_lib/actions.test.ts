import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockGetAccessToken,
  mockUpdateTag,
  mockUpdateTenantCrawlerSettings,
  mockUpdateTenantCreatorPageSettings,
  mockUpdateTenantEmailRejectionSettings,
  mockUpdateTenantLegalPages,
  mockUpdateTenantLocales,
  mockUpdateTenantSignUpSettings,
  mockUpdateTenantSiteSettings,
  mockUpdateTenantSiteVerification,
  mockUpdateTenantTimezone,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUpdateTenantCrawlerSettings: vi.fn(),
  mockUpdateTenantCreatorPageSettings: vi.fn(),
  mockUpdateTenantEmailRejectionSettings: vi.fn(),
  mockUpdateTenantLegalPages: vi.fn(),
  mockUpdateTenantLocales: vi.fn(),
  mockUpdateTenantSignUpSettings: vi.fn(),
  mockUpdateTenantSiteSettings: vi.fn(),
  mockUpdateTenantSiteVerification: vi.fn(),
  mockUpdateTenantTimezone: vi.fn(),
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

vi.mock("#lib/access-ticket", () => ({
  accessTicketsCacheTag: (tenantId: string) => `access-tickets-${tenantId}`,
}));

vi.mock("#lib/episode", () => ({
  episodesCacheTag: (tenantId: string) => `episodes-${tenantId}`,
}));

vi.mock("#lib/purchase", () => ({
  purchasesCacheTag: (tenantId: string) => `purchases-${tenantId}`,
}));

vi.mock("#lib/series", () => ({
  seriesListCacheTag: (tenantId: string) => `series-list-${tenantId}`,
}));

vi.mock("#lib/session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("#lib/admin-auth", () => ({
  requestAdminEmailChange: vi.fn(),
}));

vi.mock("#lib/genre", () => ({
  genresCacheTag: (tenantId: string) => `genres-${tenantId}`,
}));

vi.mock("#lib/public-api", () => ({
  tenantSiteCacheTag: (tenantId: string) => `tenant:${tenantId}:site`,
}));

vi.mock("#lib/site-settings", () => ({
  tenantSiteSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:site-settings`,
  updateTenantSiteSettings: mockUpdateTenantSiteSettings,
}));

vi.mock("#lib/tenant-locales", () => ({
  updateTenantLocales: mockUpdateTenantLocales,
}));

vi.mock("#lib/tenant-crawler-settings", () => ({
  tenantCrawlerSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:crawler-settings`,
  updateTenantCrawlerSettings: mockUpdateTenantCrawlerSettings,
}));

vi.mock("#lib/tenant-creator-page-settings", () => ({
  tenantCreatorPageSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:creator-page-settings`,
  updateTenantCreatorPageSettings: mockUpdateTenantCreatorPageSettings,
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

vi.mock("#lib/tenant-sign-up-settings", () => ({
  tenantSignUpSettingsCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:sign-up-settings`,
  updateTenantSignUpSettings: mockUpdateTenantSignUpSettings,
}));

vi.mock("#lib/tenant-site-verification", () => ({
  tenantSiteVerificationCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:site-verification`,
  updateTenantSiteVerification: mockUpdateTenantSiteVerification,
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

// Evaluating the Actions' module graph for the first time takes far longer than
// any test's own work, so it is paid here rather than inside one test's timeout.
beforeAll(async () => {
  await import("./actions");
});

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

/** A form as the languages card submits it: one entry per offered language. */
const localesFormData = (values: {
  defaultLocale?: string;
  supportedLocales: readonly string[];
  tenantId?: string;
}): FormData => {
  const formData = new FormData();

  if (values.tenantId !== undefined) {
    formData.set("tenant_id", values.tenantId);
  }

  if (values.defaultLocale !== undefined) {
    formData.set("default_locale", values.defaultLocale);
  }

  for (const code of values.supportedLocales) {
    formData.append("supported_locales", code);
  }

  return formData;
};

describe("updateTenantLocalesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("saves the default with the languages offered and revalidates the cache tags", async () => {
    mockUpdateTenantLocales.mockResolvedValueOnce({
      defaultLocale: "en",
      ok: true,
      supportedLocales: ["ja", "en"],
    });

    const { updateTenantLocalesAction } = await import("./actions");

    const result = await updateTenantLocalesAction(
      null,
      localesFormData({
        defaultLocale: "en",
        supportedLocales: ["ja", "en"],
        tenantId: "TENANT001",
      })
    );

    expect(result).toEqual({
      message: "The languages were saved.",
      ok: true,
    });
    expect(mockUpdateTenantLocales).toHaveBeenCalledWith(
      {
        defaultLocale: "en",
        supportedLocales: ["ja", "en"],
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag.mock.calls.map(([tag]) => tag).toSorted()).toEqual([
      "access-tickets-TENANT001",
      "episodes-TENANT001",
      "genres-TENANT001",
      "purchases-TENANT001",
      "series-list-TENANT001",
      "tenant:TENANT001:site",
    ]);
  });

  it.each([
    { label: "an unknown locale", locale: "fr" },
    { label: "an uppercase code", locale: "EN" },
    { label: "a BCP 47 tag", locale: "ja-JP" },
    { label: "an empty string", locale: "  " },
  ])(
    "rejects $label as the default without calling the API",
    async ({ locale }) => {
      const { updateTenantLocalesAction } = await import("./actions");

      const result = await updateTenantLocalesAction(
        null,
        localesFormData({
          defaultLocale: locale,
          supportedLocales: [locale],
          tenantId: "TENANT001",
        })
      );

      expect(result).toEqual({
        message: "Select a language.",
        ok: false,
      });
      expect(mockUpdateTenantLocales).not.toHaveBeenCalled();
      expect(mockUpdateTag).not.toHaveBeenCalled();
    }
  );

  it("rejects an offered language this build does not serve", async () => {
    const { updateTenantLocalesAction } = await import("./actions");

    const result = await updateTenantLocalesAction(
      null,
      localesFormData({
        defaultLocale: "en",
        supportedLocales: ["en", "fr"],
        tenantId: "TENANT001",
      })
    );

    expect(result).toEqual({
      message: "Choose the languages offered from the list.",
      ok: false,
    });
    expect(mockUpdateTenantLocales).not.toHaveBeenCalled();
  });

  // The form always sends the default among the languages offered, so a set
  // without it is a tampered request, refused before it reaches the API.
  it.each([
    { label: "a set that leaves the default out", supportedLocales: ["ja"] },
    { label: "an empty set", supportedLocales: [] },
  ])("refuses $label", async ({ supportedLocales }) => {
    const { updateTenantLocalesAction } = await import("./actions");

    const result = await updateTenantLocalesAction(
      null,
      localesFormData({
        defaultLocale: "en",
        supportedLocales,
        tenantId: "TENANT001",
      })
    );

    expect(result).toEqual({
      message: "The default language must be one of the languages offered.",
      ok: false,
    });
    expect(mockUpdateTenantLocales).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("does not save when the tenant id is missing", async () => {
    const { updateTenantLocalesAction } = await import("./actions");

    const result = await updateTenantLocalesAction(
      null,
      localesFormData({ defaultLocale: "en", supportedLocales: ["en"] })
    );

    expect(result).toEqual({
      message: "The tenant ID is missing.",
      ok: false,
    });
    expect(mockUpdateTenantLocales).not.toHaveBeenCalled();
  });

  it("returns the message and leaves the cache tag alone when the save fails", async () => {
    mockUpdateTenantLocales.mockResolvedValueOnce({
      message: "You do not have permission.",
      ok: false,
    });

    const { updateTenantLocalesAction } = await import("./actions");

    const result = await updateTenantLocalesAction(
      null,
      localesFormData({
        defaultLocale: "en",
        supportedLocales: ["en"],
        tenantId: "TENANT001",
      })
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

  it("saves the copy in the language of the tab it was sent from", async () => {
    mockUpdateTenantSiteSettings.mockResolvedValueOnce({
      ok: true,
      settings: {
        copyrightText: "",
        siteDescription: "",
        siteTagline: "Read in English",
      },
    });

    const { updateSiteSettingsAction } = await import("./actions");

    await updateSiteSettingsAction(
      null,
      textFormData({
        copyright_text: "",
        site_description: "",
        site_tagline: "Read in English",
        tenant_id: "TENANT001",
        translation_locale: "en",
      })
    );

    expect(mockUpdateTenantSiteSettings).toHaveBeenCalledWith(
      {
        copyrightText: "",
        siteDescription: "",
        siteTagline: "Read in English",
        tenantId: "TENANT001",
        translationLocale: "en",
      },
      "en"
    );
  });

  it("saves the default language's copy from a card without tabs", async () => {
    mockUpdateTenantSiteSettings.mockResolvedValueOnce({
      ok: true,
      settings: { copyrightText: "", siteDescription: "", siteTagline: "" },
    });

    const { updateSiteSettingsAction } = await import("./actions");

    await updateSiteSettingsAction(
      null,
      textFormData({ tenant_id: "TENANT001", translation_locale: "" })
    );

    expect(mockUpdateTenantSiteSettings).toHaveBeenCalledWith(
      expect.objectContaining({ translationLocale: undefined }),
      "en"
    );
  });

  it("refuses a language this build does not serve without calling the API", async () => {
    const { updateSiteSettingsAction } = await import("./actions");

    const result = await updateSiteSettingsAction(
      null,
      textFormData({ tenant_id: "TENANT001", translation_locale: "fr" })
    );

    expect(result).toEqual({
      message:
        "This site does not offer that language. Switch it on under Languages first.",
      ok: false,
    });
    expect(mockUpdateTenantSiteSettings).not.toHaveBeenCalled();
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

/** The card's form: one box per ticked crawler, and one field per path input. */
const CRAWLER_TENANT_ID = "018f1070-0001-7000-8000-000000000001";

const crawlerFormData = (
  userAgents: string[],
  paths: string[],
  tenantId: string = CRAWLER_TENANT_ID
): FormData => {
  const formData = textFormData({ tenant_id: tenantId });

  for (const userAgent of userAgents) {
    formData.append("excluded_user_agents", userAgent);
  }

  for (const path of paths) {
    formData.append("excluded_paths", path);
  }

  return formData;
};

describe("updateTenantCrawlerSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("sends the ticked crawlers and each non-blank path, then revalidates the tag", async () => {
    const settings = {
      excludedPaths: ["/drafts", "/members"],
      excludedUserAgents: ["GPTBot", "CCBot"],
    };

    mockUpdateTenantCrawlerSettings.mockResolvedValueOnce({
      ok: true,
      settings,
    });

    const { updateTenantCrawlerSettingsAction } = await import("./actions");

    const result = await updateTenantCrawlerSettingsAction(
      null,
      crawlerFormData(["GPTBot", "CCBot"], [" /members/ ", "", "/drafts"])
    );

    expect(result).toEqual({
      message: "The crawler exclusions were saved.",
      ok: true,
      settings,
    });
    expect(mockUpdateTenantCrawlerSettings).toHaveBeenCalledWith(
      {
        excludedPaths: ["/members/", "/drafts"],
        excludedUserAgents: ["GPTBot", "CCBot"],
        tenantId: CRAWLER_TENANT_ID,
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      `tenant:${CRAWLER_TENANT_ID}:crawler-settings`
    );
  });

  it("reads no ticked box and empty fields as excluding nothing", async () => {
    mockUpdateTenantCrawlerSettings.mockResolvedValueOnce({
      ok: true,
      settings: { excludedPaths: [], excludedUserAgents: [] },
    });

    const { updateTenantCrawlerSettingsAction } = await import("./actions");

    await updateTenantCrawlerSettingsAction(null, crawlerFormData([], [""]));

    expect(mockUpdateTenantCrawlerSettings).toHaveBeenCalledWith(
      {
        excludedPaths: [],
        excludedUserAgents: [],
        tenantId: CRAWLER_TENANT_ID,
      },
      "en"
    );
  });

  it.each([
    [
      "drafts",
      '"drafts" is not a path. Start it with / and leave out spaces, *, $, ?, and #.',
    ],
    [
      "/sitemap/series",
      '"/sitemap/series" cannot be excluded, since crawlers need robots.txt and the sitemap to read the site.',
    ],
  ])(
    "names the path %s it refuses without calling the API",
    async (path, message) => {
      const { updateTenantCrawlerSettingsAction } = await import("./actions");

      const result = await updateTenantCrawlerSettingsAction(
        null,
        crawlerFormData(["GPTBot"], ["/drafts", path])
      );

      expect(result).toEqual({
        fieldErrors: { excludedPaths: message },
        message,
        ok: false,
      });
      expect(mockUpdateTenantCrawlerSettings).not.toHaveBeenCalled();
      expect(mockUpdateTag).not.toHaveBeenCalled();
    }
  );

  it("refuses more paths than the server keeps without calling the API", async () => {
    const paths = Array.from({ length: 101 }, (_, index) => `/p${index}`);

    const { updateTenantCrawlerSettingsAction } = await import("./actions");

    const result = await updateTenantCrawlerSettingsAction(
      null,
      crawlerFormData([], paths)
    );

    expect(result).toEqual({
      fieldErrors: { excludedPaths: "List at most 100 paths." },
      message: "List at most 100 paths.",
      ok: false,
    });
    expect(mockUpdateTenantCrawlerSettings).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", ""],
    ["not a tenant id", "TENANT001"],
  ])(
    "refuses a tenant id that is %s without calling the API",
    async (_, tenantId) => {
      const { updateTenantCrawlerSettingsAction } = await import("./actions");

      const result = await updateTenantCrawlerSettingsAction(
        null,
        crawlerFormData(["GPTBot"], [], tenantId)
      );

      expect(result?.ok).toBe(false);
      expect(mockUpdateTenantCrawlerSettings).not.toHaveBeenCalled();
    }
  );

  it("puts the API's refusal beside the part it refused without revalidating", async () => {
    const message =
      "Applebot can no longer be excluded. Reload the page and choose again.";

    mockUpdateTenantCrawlerSettings.mockResolvedValueOnce({
      fieldErrors: { excludedUserAgents: message },
      message,
      ok: false,
    });

    const { updateTenantCrawlerSettingsAction } = await import("./actions");

    const result = await updateTenantCrawlerSettingsAction(
      null,
      crawlerFormData(["Applebot"], [])
    );

    expect(result).toEqual({
      fieldErrors: { excludedUserAgents: message },
      message,
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

describe("updateTenantSignUpSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("closes sign-up with the trimmed message and revalidates the tag", async () => {
    const settings = {
      closedMessage: "We open again in spring.",
      signUpOpen: false,
    };

    mockUpdateTenantSignUpSettings.mockResolvedValueOnce({
      ok: true,
      settings,
    });

    const { updateTenantSignUpSettingsAction } = await import("./actions");

    const result = await updateTenantSignUpSettingsAction(
      null,
      textFormData({
        closed_message: "  We open again in spring.  ",
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({
      message:
        "Sign-up is closed. Visitors see your message in place of the sign-up form.",
      ok: true,
      settings,
    });
    expect(mockUpdateTenantSignUpSettings).toHaveBeenCalledWith(
      {
        closedMessage: "We open again in spring.",
        signUpOpen: false,
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:sign-up-settings"
    );
  });

  it("opens sign-up while the switch posts on", async () => {
    const settings = { closedMessage: "Kept.", signUpOpen: true };
    mockUpdateTenantSignUpSettings.mockResolvedValueOnce({
      ok: true,
      settings,
    });

    const { updateTenantSignUpSettingsAction } = await import("./actions");

    const result = await updateTenantSignUpSettingsAction(
      null,
      textFormData({
        closed_message: "Kept.",
        sign_up_open: "on",
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({
      message: "Sign-up is open. Visitors can create a reader account.",
      ok: true,
      settings,
    });
    expect(mockUpdateTenantSignUpSettings).toHaveBeenCalledWith(
      { closedMessage: "Kept.", signUpOpen: true, tenantId: "TENANT001" },
      "en"
    );
  });

  // The server counts characters, so a message of 1000 emoji is within the
  // bound although its UTF-16 length is twice that.
  it("measures the message in characters, as the server does", async () => {
    mockUpdateTenantSignUpSettings.mockResolvedValueOnce({
      ok: true,
      settings: { closedMessage: "🌸".repeat(1000), signUpOpen: false },
    });

    const { updateTenantSignUpSettingsAction } = await import("./actions");

    const result = await updateTenantSignUpSettingsAction(
      null,
      textFormData({
        closed_message: "🌸".repeat(1000),
        tenant_id: "TENANT001",
      })
    );

    expect(result?.ok).toBe(true);
  });

  it("refuses a message over the bound beside the field without saving", async () => {
    const { updateTenantSignUpSettingsAction } = await import("./actions");

    const result = await updateTenantSignUpSettingsAction(
      null,
      textFormData({ closed_message: "a".repeat(1001), tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      fieldErrors: {
        closedMessage: "Keep the message to 1,000 characters or fewer.",
      },
      message: "Keep the message to 1,000 characters or fewer.",
      ok: false,
    });
    expect(mockUpdateTenantSignUpSettings).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("shows the server's refusal of the message beside the field", async () => {
    mockUpdateTenantSignUpSettings.mockResolvedValueOnce({
      closedMessageError: "Keep the message to 1,000 characters or fewer.",
      message: "Keep the message to 1,000 characters or fewer.",
      ok: false,
    });

    const { updateTenantSignUpSettingsAction } = await import("./actions");

    const result = await updateTenantSignUpSettingsAction(
      null,
      textFormData({ closed_message: "Closed.", tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      fieldErrors: {
        closedMessage: "Keep the message to 1,000 characters or fewer.",
      },
      message: "Keep the message to 1,000 characters or fewer.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

const SITE_VERIFICATION_TENANT_ID = "018f1140-0001-7000-8000-000000000001";

const siteVerificationFormData = (
  google: string,
  bing: string,
  tenantId: string = SITE_VERIFICATION_TENANT_ID
): FormData =>
  textFormData({
    bing_site_verification: bing,
    google_site_verification: google,
    tenant_id: tenantId,
  });

describe("updateTenantSiteVerificationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("sends only the content value of a pasted <meta> element, then revalidates the tag", async () => {
    const siteVerification = { bing: "0123ABCD", google: "abc-DEF_123" };
    mockUpdateTenantSiteVerification.mockResolvedValueOnce({
      ok: true,
      siteVerification,
    });

    const { updateTenantSiteVerificationAction } = await import("./actions");

    const result = await updateTenantSiteVerificationAction(
      null,
      siteVerificationFormData(
        '<meta name="google-site-verification" content="abc-DEF_123" />',
        " 0123ABCD "
      )
    );

    expect(result).toEqual({
      message: "The verification codes were saved.",
      ok: true,
      siteVerification,
    });
    expect(mockUpdateTenantSiteVerification).toHaveBeenCalledWith(
      {
        bing: "0123ABCD",
        google: "abc-DEF_123",
        tenantId: SITE_VERIFICATION_TENANT_ID,
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      `tenant:${SITE_VERIFICATION_TENANT_ID}:site-verification`
    );
  });

  it("sends empty fields as clearing both codes", async () => {
    mockUpdateTenantSiteVerification.mockResolvedValueOnce({
      ok: true,
      siteVerification: { bing: "", google: "" },
    });

    const { updateTenantSiteVerificationAction } = await import("./actions");

    await updateTenantSiteVerificationAction(
      null,
      siteVerificationFormData("", "  ")
    );

    expect(mockUpdateTenantSiteVerification).toHaveBeenCalledWith(
      { bing: "", google: "", tenantId: SITE_VERIFICATION_TENANT_ID },
      "en"
    );
  });

  it.each([
    [
      "a value with a space",
      "abc def",
      "",
      {
        google:
          "Paste the whole <meta> tag, or only its content value: up to 128 letters, digits, hyphens, and underscores.",
      },
    ],
    [
      "the other service's element",
      "",
      '<meta name="google-site-verification" content="abc123" />',
      {
        bing: "This is not a msvalidate.01 tag. Copy the tag this service shows.",
      },
    ],
  ])(
    "names the field holding %s without calling the API",
    async (_, google, bing, fieldErrors) => {
      const { updateTenantSiteVerificationAction } = await import("./actions");

      const result = await updateTenantSiteVerificationAction(
        null,
        siteVerificationFormData(google, bing)
      );

      expect(result).toEqual({
        fieldErrors: { bing: undefined, google: undefined, ...fieldErrors },
        message: expect.any(String),
        ok: false,
      });
      expect(mockUpdateTenantSiteVerification).not.toHaveBeenCalled();
      expect(mockUpdateTag).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["missing", ""],
    ["not a tenant id", "TENANT001"],
  ])(
    "refuses a tenant id that is %s without calling the API",
    async (_, tenantId) => {
      const { updateTenantSiteVerificationAction } = await import("./actions");

      const result = await updateTenantSiteVerificationAction(
        null,
        siteVerificationFormData("abc123", "", tenantId)
      );

      expect(result?.ok).toBe(false);
      expect(mockUpdateTenantSiteVerification).not.toHaveBeenCalled();
    }
  );

  it("puts the API's refusal beside the field it refused without revalidating", async () => {
    const message =
      "Paste the whole <meta> tag, or only its content value: up to 128 letters, digits, hyphens, and underscores.";

    mockUpdateTenantSiteVerification.mockResolvedValueOnce({
      fieldErrors: { bing: message },
      message,
      ok: false,
    });

    const { updateTenantSiteVerificationAction } = await import("./actions");

    const result = await updateTenantSiteVerificationAction(
      null,
      siteVerificationFormData("abc123", "0123ABCD")
    );

    expect(result).toEqual({
      fieldErrors: { bing: message },
      message,
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

const CREATOR_PAGE_TENANT_ID = "018f1080-0001-7000-8000-000000000001";

const creatorPageFormData = (
  switches: { pages?: string; sales?: string },
  tenantId: string | File = CREATOR_PAGE_TENANT_ID
): FormData => {
  const formData = new FormData();

  formData.set("tenant_id", tenantId);

  if (switches.pages !== undefined) {
    formData.set("creator_pages_enabled", switches.pages);
  }

  if (switches.sales !== undefined) {
    formData.set("creator_pages_show_sales", switches.sales);
  }

  return formData;
};

describe("updateTenantCreatorPageSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("saves sales while the pages stay off, then revalidates the tag", async () => {
    mockUpdateTenantCreatorPageSettings.mockResolvedValueOnce({
      creatorPagesEnabled: false,
      creatorPagesShowSales: true,
      ok: true,
    });

    const { updateTenantCreatorPageSettingsAction } = await import("./actions");

    const result = await updateTenantCreatorPageSettingsAction(
      null,
      creatorPageFormData({ sales: "on" })
    );

    expect(result).toEqual({
      message: "The author page settings were saved.",
      ok: true,
    });
    expect(mockUpdateTenantCreatorPageSettings).toHaveBeenCalledWith(
      {
        creatorPagesEnabled: false,
        creatorPagesShowSales: true,
        tenantId: CREATOR_PAGE_TENANT_ID,
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith(
      `tenant:${CREATOR_PAGE_TENANT_ID}:creator-page-settings`
    );
  });

  it.each([
    ["missing", ""],
    ["not a tenant id", "TENANT001"],
    ["a file", new File(["id"], "tenant.txt", { type: "text/plain" })],
  ])(
    "refuses a tenant id that is %s without calling the API",
    async (_, tenantId) => {
      const { updateTenantCreatorPageSettingsAction } =
        await import("./actions");

      const result = await updateTenantCreatorPageSettingsAction(
        null,
        creatorPageFormData({ sales: "on" }, tenantId)
      );

      expect(result).toEqual({
        message:
          "The tenant ID could not be found. Check the URL and try again.",
        ok: false,
      });
      expect(mockUpdateTenantCreatorPageSettings).not.toHaveBeenCalled();
      expect(mockUpdateTag).not.toHaveBeenCalled();
    }
  );
});
