import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockGetAccessToken,
  mockGetTenantConfigApi,
  mockUpdateTenantConfigApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockGetTenantConfigApi: vi.fn(),
  mockUpdateTenantConfigApi: vi.fn(),
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
    auth: {
      getTenantConfig: mockGetTenantConfigApi,
      updateTenantConfig: mockUpdateTenantConfigApi,
    },
  },
  withSessionHeaders: (sessionId: string) => ({
    headers: { Authorization: `Bearer ${sessionId}` },
  }),
}));

describe("getTenantSiteSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("returns the settings the tenant config answered with", async () => {
    mockGetTenantConfigApi.mockResolvedValueOnce({
      copyrightText: "© Example",
      siteDescription: "A description",
      siteTagline: "A tagline",
    });

    const { getTenantSiteSettings } = await import("./site-settings");

    const result = await getTenantSiteSettings("TENANT001", "en", "en");

    expect(result).toEqual({
      ok: true,
      settings: {
        copyrightText: "© Example",
        siteDescription: "A description",
        siteTagline: "A tagline",
      },
    });
    expect(mockGetTenantConfigApi).toHaveBeenCalledWith(
      { locale: "en", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("reads the default language's copy when it names no language", async () => {
    mockGetTenantConfigApi.mockResolvedValueOnce({});

    const { getTenantSiteSettings } = await import("./site-settings");
    await getTenantSiteSettings("TENANT001", undefined, "en");

    expect(mockGetTenantConfigApi).toHaveBeenCalledWith(
      { locale: "", tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("asks for a sign-in without calling the API when there is no session", async () => {
    mockGetAccessToken.mockResolvedValue("");

    const { getTenantSiteSettings } = await import("./site-settings");
    const result = await getTenantSiteSettings("TENANT001", "en", "en");

    expect(mockGetTenantConfigApi).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, requiresSignIn: true });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("reports a failed read as a message", async () => {
    mockGetTenantConfigApi.mockRejectedValueOnce(
      new ConnectError("upstream down", Code.Unavailable)
    );

    const { getTenantSiteSettings } = await import("./site-settings");
    const result = await getTenantSiteSettings("TENANT001", "en", "en");

    expect(result).toMatchObject({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
      requiresSignIn: false,
    });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  // The cache fill itself must not throw, or the request fails before any
  // boundary can render; the exported read throws once outside the scope.
  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockGetTenantConfigApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { getTenantSiteSettings } = await import("./site-settings");

    await expect(
      getTenantSiteSettings("TENANT001", "en", "en")
    ).rejects.toThrow(Error);
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("files the settings under the tenant site settings tag", async () => {
    mockGetTenantConfigApi.mockResolvedValueOnce({});

    const { getTenantSiteSettings, tenantSiteSettingsCacheTag } =
      await import("./site-settings");

    await getTenantSiteSettings("TENANT001", "en", "en");

    expect(mockCacheTag).toHaveBeenCalledWith(
      tenantSiteSettingsCacheTag("TENANT001")
    );
  });

  it("tenantSiteSettingsCacheTag normalizes the tenant id", async () => {
    const { tenantSiteSettingsCacheTag } = await import("./site-settings");

    expect(tenantSiteSettingsCacheTag("  TENANT001 ")).toBe(
      "tenant:TENANT001:site-settings"
    );
  });
});

/** The site copy the config RPC answers for one language. */
interface SiteCopy {
  copyrightText: string;
  siteDescription: string;
  siteTagline: string;
}

describe("getTenantSiteSettingsTabs", () => {
  const copies = new Map<string, SiteCopy>([
    [
      "en",
      {
        copyrightText: "",
        siteDescription: "",
        siteTagline: "Read in English",
      },
    ],
    [
      "ja",
      {
        copyrightText: "",
        siteDescription: "",
        siteTagline: "Read in Japanese",
      },
    ],
    ["ko", { copyrightText: " ", siteDescription: "", siteTagline: "" }],
  ]);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
    mockGetTenantConfigApi.mockImplementation(
      ({ locale }: { locale: string }) =>
        Promise.resolve(copies.get(locale) ?? {})
    );
  });

  const tenantLocales = {
    defaultLocale: "ja",
    supportedLocales: ["ja", "en", "ko"],
  } as const;

  it("opens on the language the URL names, with that language's copy", async () => {
    const { getTenantSiteSettingsTabs } = await import("./site-settings");

    const result = await getTenantSiteSettingsTabs({
      locale: "en",
      requestedLocale: "en",
      tenantId: "TENANT001",
      tenantLocales,
    });

    expect(result).toEqual({
      locales: ["ja", "en", "ko"],
      ok: true,
      settings: {
        copyrightText: "",
        siteDescription: "",
        siteTagline: "Read in English",
      },
      shownLocale: "en",
      // Blank fields are no copy.
      translatedLocales: ["ja", "en"],
    });
  });

  it("opens on the default language when the URL names one the site does not offer", async () => {
    const { getTenantSiteSettingsTabs } = await import("./site-settings");

    const result = await getTenantSiteSettingsTabs({
      locale: "en",
      requestedLocale: "zh-Hans",
      tenantId: "TENANT001",
      tenantLocales,
    });

    expect(result).toMatchObject({
      locales: ["ja", "en", "ko"],
      settings: { siteTagline: "Read in Japanese" },
      shownLocale: "ja",
    });
    expect(mockGetTenantConfigApi).not.toHaveBeenCalledWith(
      expect.objectContaining({ locale: "zh-Hans" }),
      expect.anything()
    );
  });

  it("edits the default language's copy without tabs when the site's languages cannot be read", async () => {
    mockGetTenantConfigApi.mockResolvedValueOnce({ siteTagline: "Default" });
    const { getTenantSiteSettingsTabs } = await import("./site-settings");

    const result = await getTenantSiteSettingsTabs({
      locale: "en",
      requestedLocale: "en",
      tenantId: "TENANT001",
      tenantLocales: null,
    });

    expect(result).toEqual({
      locales: [],
      ok: true,
      settings: {
        copyrightText: "",
        siteDescription: "",
        siteTagline: "Default",
      },
      shownLocale: undefined,
      translatedLocales: [],
    });
    expect(mockGetTenantConfigApi).toHaveBeenCalledOnce();
    expect(mockGetTenantConfigApi).toHaveBeenCalledWith(
      { locale: "", tenant: { tenantId: "TENANT001" } },
      expect.anything()
    );
  });

  it("fails as a whole when one language's copy cannot be read", async () => {
    mockGetTenantConfigApi.mockImplementation(
      ({ locale }: { locale: string }) =>
        locale === "ko"
          ? Promise.reject(new ConnectError("upstream down", Code.Unavailable))
          : Promise.resolve(copies.get(locale) ?? {})
    );
    const { getTenantSiteSettingsTabs } = await import("./site-settings");

    const result = await getTenantSiteSettingsTabs({
      locale: "en",
      requestedLocale: undefined,
      tenantId: "TENANT001",
      tenantLocales,
    });

    expect(result).toMatchObject({
      message: "Could not connect to the server. Please try again later.",
      ok: false,
      requiresSignIn: false,
    });
  });
});

describe("updateTenantSiteSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  const input = {
    copyrightText: "Copyright 2026 Acme Inc.",
    siteDescription: "Release announcements.",
    siteTagline: "Read quietly",
    tenantId: "TENANT001",
  };

  it("saves the copy in the language it names", async () => {
    mockUpdateTenantConfigApi.mockResolvedValueOnce({
      ...input,
      locale: "en",
    });
    const { updateTenantSiteSettings } = await import("./site-settings");

    const result = await updateTenantSiteSettings(
      { ...input, translationLocale: "en" },
      "ja"
    );

    expect(mockUpdateTenantConfigApi).toHaveBeenCalledWith(
      {
        copyrightText: "Copyright 2026 Acme Inc.",
        locale: "en",
        siteDescription: "Release announcements.",
        siteTagline: "Read quietly",
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(result).toEqual({
      ok: true,
      settings: {
        copyrightText: "Copyright 2026 Acme Inc.",
        siteDescription: "Release announcements.",
        siteTagline: "Read quietly",
      },
    });
  });

  it("saves the default language's copy when it names no language", async () => {
    mockUpdateTenantConfigApi.mockResolvedValueOnce(input);
    const { updateTenantSiteSettings } = await import("./site-settings");

    await updateTenantSiteSettings(input, "en");

    expect(mockUpdateTenantConfigApi).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "" }),
      expect.anything()
    );
  });

  it("words a language the site does not offer apart from other refused input", async () => {
    mockUpdateTenantConfigApi.mockRejectedValueOnce(
      new ConnectError(
        "locale must be a locale the tenant offers",
        Code.InvalidArgument,
        undefined,
        [
          {
            desc: BadRequestSchema,
            value: { fieldViolations: [{ field: "locale" }] },
          },
        ]
      )
    );
    const { updateTenantSiteSettings } = await import("./site-settings");

    const result = await updateTenantSiteSettings(
      { ...input, translationLocale: "ko" },
      "en"
    );

    expect(result).toEqual({
      message:
        "This site does not offer that language. Switch it on under Languages first.",
      ok: false,
    });
  });
});
