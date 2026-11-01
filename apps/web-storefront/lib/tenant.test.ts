import { Code, ConnectError } from "@publira/api-client/errors";
import {
  AgeVerification,
  AppPurchaseRoute,
  TenantBrandMarkKind,
} from "@publira/api-client/public/types";
import { DEFAULT_TENANT_THEME_COLORS } from "@publira/utils/theme-css-variables";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  consentPages,
  getTenantAgeVerification,
  getTenantDefaultLocale,
  getTenantDisplayTimeZone,
  getTenantLegalPages,
  getTenantLinkDefaultLocale,
  getTenantLinkSupportedLocales,
  getTenantPublicOrigin,
  getTenantSignInClients,
  getTenantCreatorPagesEnabled,
  getTenantSignUp,
  getTenantSiteCopy,
  getTenantSiteInfo,
  getTenantSupportedLocales,
  getTenantTheme,
  getTenantWebPushPublicKey,
  readConsentPageVersionIds,
} from "./tenant";

const { mockCacheLife, mockCacheTag, mockGetTenant, mockGetTenantLegalPages } =
  vi.hoisted(() => ({
    mockCacheLife: vi.fn(),
    mockCacheTag: vi.fn(),
    mockGetTenant: vi.fn(),
    mockGetTenantLegalPages: vi.fn(),
  }));

// The reads run without the Next.js cache runtime here, so the `"use cache"`
// helpers are stubbed rather than exercised.
vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./api-client", () => ({
  apiClient: {
    tenant: {
      getTenant: mockGetTenant,
      getTenantLegalPages: mockGetTenantLegalPages,
    },
  },
}));

const tenantResponse = {
  acceptsPayments: true,
  copyrightText: "© Example",
  currency: "USD",
  defaultLocale: "en",
  signUpClosedMessage: "",
  signUpOpen: true,
  siteDescription: "",
  siteTagline: "",
  supportedLocales: ["ja", "en"],
  tenantDomain: "example.test",
  tenantName: "Example Tenant",
  tenantPublicId: "TENANT_PUBLIC",
  theme: undefined,
  timezone: "America/Los_Angeles",
};

const brandingVariant = (url: string) => ({
  contentType: "image/png",
  fileSizeBytes: 1024,
  height: 64,
  label: "original",
  url,
  variantType: "icon",
  width: 64,
});

describe("tenant", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockCacheLife.mockReset();
    mockCacheTag.mockReset();
    mockGetTenant.mockReset();
    mockGetTenantLegalPages.mockReset();
  });

  it("Add a dedicated tag to theme reading for theme.css", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      theme: { primaryColor: "#112233" },
    });

    await expect(getTenantTheme(" TENANT_001 ")).resolves.toMatchObject({
      dark: undefined,
      light: { primaryColor: "#112233" },
    });

    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT_001:theme");
    expect(mockGetTenant).toHaveBeenCalledWith({
      tenant: { tenantId: "TENANT_001" },
    });
  });

  it("reads the dark palette beside the light one", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      darkTheme: { ...DEFAULT_TENANT_THEME_COLORS, backgroundColor: "#1A1917" },
      theme: { primaryColor: "#112233" },
    });

    await expect(getTenantTheme("TENANT_001")).resolves.toMatchObject({
      dark: { backgroundColor: "#1a1917" },
      light: { primaryColor: "#112233" },
    });
  });

  it("offers no dark theme for a dark palette missing a color", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      darkTheme: { ...DEFAULT_TENANT_THEME_COLORS, mutedColor: "" },
    });

    await expect(getTenantTheme("TENANT_001")).resolves.toMatchObject({
      dark: undefined,
    });
  });

  it("Add public API time zone to site information", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    const info = await getTenantSiteInfo("TENANT_001");

    expect(mockGetTenant).toHaveBeenCalledWith({
      tenant: { tenantId: "TENANT_001" },
    });
    expect(info?.timeZone).toBe("America/Los_Angeles");
    expect(info?.acceptsPayments).toBe(true);
  });

  it("Carry the currency the tenant sells in", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.currency).toBe("USD");
  });

  it("Read no tenant from a response that names no currency", async () => {
    mockGetTenant.mockResolvedValueOnce({ ...tenantResponse, currency: "" });

    expect(await getTenantSiteInfo("TENANT_001")).toBeNull();
  });

  it("Treat tenants that cannot accept payments as false", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      acceptsPayments: false,
    });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.acceptsPayments).toBe(false);
  });

  it("Carry where the app sells through the stores without a web payment provider", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      acceptsAppStorePayments: false,
      acceptsGooglePlayPayments: true,
      acceptsPayments: false,
      appPurchaseRoute: AppPurchaseRoute.STORE,
    });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.appPayments).toEqual({ appStore: false, googlePlay: true });
  });

  it("Carry the store listings of the tenant's app", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      appStoreUrl: " https://apps.apple.com/app/id123 ",
      googlePlayUrl: "https://play.google.com/store/apps/details?id=test",
    });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.appStoreUrl).toBe("https://apps.apple.com/app/id123");
    expect(info?.googlePlayUrl).toBe(
      "https://play.google.com/store/apps/details?id=test"
    );
  });

  it("Offer a sign-in provider only where the site has a client to sign in through", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      appleSignIn: { servicesId: "" },
      googleSignIn: { iosClientId: "ios-client", webClientId: " web-client " },
    });

    await expect(getTenantSignInClients("TENANT_001")).resolves.toEqual({
      google: "web-client",
    });
  });

  it("Offer no sign-in provider where the tenant enabled none", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    await expect(getTenantSignInClients("TENANT_001")).resolves.toEqual({});
  });

  it("Carry the pages the tenant names as its terms and privacy policy in the reader's locale", async () => {
    mockGetTenantLegalPages.mockResolvedValueOnce({
      privacyPage: {
        slug: "/privacy",
        title: "Privacy policy",
        versionId: "privacy-v2",
      },
      termsPage: {
        slug: "/legal/terms",
        title: " Terms of service ",
        versionId: "terms-v1",
      },
    });

    await expect(getTenantLegalPages("TENANT_001", "ja")).resolves.toEqual({
      privacyPage: {
        href: "/privacy",
        title: "Privacy policy",
        versionId: "privacy-v2",
      },
      termsPage: {
        href: "/legal/terms",
        title: "Terms of service",
        versionId: "terms-v1",
      },
    });
    expect(mockGetTenantLegalPages).toHaveBeenCalledWith({
      locale: "ja",
      tenant: { tenantId: "TENANT_001" },
    });
  });

  it("Treat a role the tenant names no page for as absent", async () => {
    mockGetTenantLegalPages.mockResolvedValueOnce({
      termsPage: { slug: "/terms", title: "Terms", versionId: "" },
    });

    await expect(getTenantLegalPages("TENANT_001", "en")).resolves.toEqual({
      privacyPage: undefined,
      termsPage: undefined,
    });
  });

  it("Ask consent to a page named for both roles once", () => {
    const page = { href: "/legal", title: "Legal", versionId: "legal-v1" };

    expect(consentPages({ privacyPage: page, termsPage: page })).toEqual([
      page,
    ]);
  });

  it("Read the versions a sign-up asks consent to past the cache", async () => {
    mockGetTenantLegalPages.mockResolvedValueOnce({
      privacyPage: { slug: "/privacy", title: "Privacy", versionId: "p-v2" },
      termsPage: { slug: "/terms", title: "Terms", versionId: "t-v1" },
    });

    await expect(
      readConsentPageVersionIds("TENANT_001", "ja")
    ).resolves.toEqual(["t-v1", "p-v2"]);
    expect(mockGetTenantLegalPages).toHaveBeenCalledWith({
      locale: "ja",
      tenant: { tenantId: "TENANT_001" },
    });
    expect(mockCacheTag).not.toHaveBeenCalled();
  });

  it("Treat a store the app is not listed in as absent", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      appStoreUrl: "",
      googlePlayUrl: "",
    });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.appStoreUrl).toBeUndefined();
    expect(info?.googlePlayUrl).toBeUndefined();
  });

  it("Carry the VAPID public key a browser subscribes to Web Push with", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      webPushVapidPublicKey: "BPublicKey",
    });

    await expect(getTenantWebPushPublicKey("TENANT_001")).resolves.toBe(
      "BPublicKey"
    );
  });

  it("Treat a deployment with no Web Push credentials as having no key", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      webPushVapidPublicKey: "",
    });

    await expect(getTenantWebPushPublicKey("TENANT_001")).resolves.toBeNull();
  });

  it("Write the tenant's public origin from its stored domain", async () => {
    vi.stubEnv("PUBLIRA_TENANT_URL_SCHEME", "");
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    await expect(getTenantPublicOrigin("TENANT_001")).resolves.toBe(
      "https://example.test"
    );
  });

  it("Write the public origin on the deployment's scheme and the saved port", async () => {
    vi.stubEnv("PUBLIRA_TENANT_URL_SCHEME", "http");
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      tenantDomain: " https://example.test:3180/ ",
    });

    await expect(getTenantPublicOrigin("TENANT_001")).resolves.toBe(
      "http://example.test:3180"
    );
  });

  it("Refuse a scheme the origin cannot be built on", async () => {
    vi.stubEnv("PUBLIRA_TENANT_URL_SCHEME", "ftp");
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    await expect(getTenantPublicOrigin("TENANT_001")).rejects.toThrow(
      "PUBLIRA_TENANT_URL_SCHEME"
    );
  });

  it("Treat a tenant with no stored domain as having no origin", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      tenantDomain: "   ",
    });

    await expect(getTenantPublicOrigin("TENANT_001")).resolves.toBeNull();
  });

  it("Take new readers where the tenant has not closed sign-up", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    await expect(getTenantSignUp("TENANT_001")).resolves.toEqual({
      open: true,
    });
  });

  it("Carry the tenant's notice while sign-up is closed", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      signUpClosedMessage: " Back in spring. ",
      signUpOpen: false,
    });

    await expect(getTenantSignUp("TENANT_001")).resolves.toEqual({
      message: "Back in spring.",
      open: false,
    });
  });

  it("Leave the notice to the site while the tenant wrote none", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      signUpOpen: false,
    });

    await expect(getTenantSignUp("TENANT_001")).resolves.toEqual({
      open: false,
    });
  });

  it("Keep the sign-up form while the tenant cannot be obtained", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(getTenantSignUp("TENANT_001")).resolves.toEqual({
      open: true,
    });
  });

  it("Show the Author pages where the tenant turned them on", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      creatorPagesEnabled: true,
    });

    await expect(getTenantCreatorPagesEnabled("TENANT_001")).resolves.toBe(
      true
    );
  });

  it("Hide the way to the Author pages while the tenant cannot be obtained", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(getTenantCreatorPagesEnabled("TENANT_001")).resolves.toBe(
      false
    );
  });

  it("Carry the ratings the tenant makes a reader prove an age for", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      ageVerification: AgeVerification.R15_AND_R18,
    });

    await expect(getTenantAgeVerification("TENANT_001")).resolves.toBe(
      "r15_and_r18"
    );
  });

  it("Treat a tenant that has chosen no age rule as asking for nothing", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      ageVerification: AgeVerification.UNSPECIFIED,
    });

    await expect(getTenantAgeVerification("TENANT_001")).resolves.toBe("none");
  });

  it("You can get the variant if the tenant icon is set.", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      theme: {
        iconImageUpdatedAt: "2026-08-19T00:00:00.000Z",
        iconImageVariants: [brandingVariant("/images/tenants/icon-1")],
      },
    });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.iconImageUpdatedAt).toBe("2026-08-19T00:00:00.000Z");
    expect(info?.iconImageVariants).toEqual([
      brandingVariant("/images/tenants/icon-1"),
    ]);
  });

  it("If tenant icon is not set, it does not have a variant.", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.iconImageVariants).toBeUndefined();
  });

  it("Variants can be obtained if the tenant logo is set.", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      theme: {
        logoImageUpdatedAt: "2026-08-19T00:00:00.000Z",
        logoImageVariants: [brandingVariant("/images/tenants/logo-1")],
      },
    });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.logoImageVariants).toEqual([
      brandingVariant("/images/tenants/logo-1"),
    ]);
  });

  it("If the tenant logo is not set, there will be no variant.", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.logoImageVariants).toBeUndefined();
  });

  it("Carry the image the tenant uploaded for the sign-in panel", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      theme: {
        signInImageUpdatedAt: "2026-10-24T00:00:00.000Z",
        signInImageVariants: [brandingVariant("/images/tenants/sign-in-1")],
      },
    });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.signInImageVariants).toEqual([
      brandingVariant("/images/tenants/sign-in-1"),
    ]);
  });

  it("Carry no sign-in image while the tenant has uploaded none", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.signInImageVariants).toBeUndefined();
  });

  it("Carry the brand marks the tenant uploaded by kind", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      brandMarks: [
        {
          imageVariants: [brandingVariant("/images/tenants/media-1/x_share")],
          kind: TenantBrandMarkKind.X_SHARE,
        },
        {
          imageVariants: [
            brandingVariant("/images/tenants/media-2/app_store_badge"),
          ],
          kind: TenantBrandMarkKind.APP_STORE_BADGE,
        },
      ],
    });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.brandMarks).toEqual({
      app_store_badge: [
        brandingVariant("/images/tenants/media-2/app_store_badge"),
      ],
      x_share: [brandingVariant("/images/tenants/media-1/x_share")],
    });
  });

  it("Drop a brand mark of a kind this build has no name for", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      brandMarks: [
        {
          imageVariants: [brandingVariant("/images/tenants/media-1/unknown")],
          kind: TenantBrandMarkKind.UNSPECIFIED,
        },
      ],
    });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.brandMarks).toBeUndefined();
  });

  it("Carry no brand marks while the tenant has uploaded none", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.brandMarks).toBeUndefined();
  });

  it("Fallback to default time zone when field is empty", async () => {
    mockGetTenant.mockResolvedValueOnce({ ...tenantResponse, timezone: "  " });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.timeZone).toBe("UTC");
  });

  it("Return tenant timezone as display timezone", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    await expect(getTenantDisplayTimeZone("TENANT_001")).resolves.toBe(
      "America/Los_Angeles"
    );
  });

  it("Display in default time zone even when tenant cannot be obtained", async () => {
    // Degrading to the host's zone would make the rendered wall clock depend on
    // where the container runs, which is exactly what the tenant zone removes.
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(getTenantDisplayTimeZone("TENANT_001")).resolves.toBe("UTC");
  });

  it("Display in default time zone even when tenant ID is empty", async () => {
    await expect(getTenantDisplayTimeZone("  ")).resolves.toBe("UTC");
    expect(mockGetTenant).not.toHaveBeenCalled();
  });

  it("List the default locale of the public API in the site information", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.defaultLocale).toBe("en");
  });

  it("refuses a locale this build serves no catalog for", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      defaultLocale: "fr",
    });

    // The chrome degrades the way any unreadable tenant does; the callers that
    // need a language to render in are the ones that hear about it.
    await expect(getTenantSiteInfo("TENANT_001")).resolves.toBeNull();
  });

  it("Return tenant settings as default locale", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    await expect(getTenantDefaultLocale("TENANT_001")).resolves.toBe("en");
  });

  it("reports an unreadable tenant instead of naming a locale", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(getTenantDefaultLocale("TENANT_001")).rejects.toThrow(
      "tenant default locale is unavailable"
    );
  });

  it("Return tenant settings as the default a link is built against", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    await expect(getTenantLinkDefaultLocale("TENANT_001")).resolves.toBe("en");
  });

  it("Build links against no default while the tenant cannot be obtained", async () => {
    // The site chrome builds its links from this on every page, so a throw
    // here would replace the whole site with an error screen during an outage.
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(getTenantLinkDefaultLocale("TENANT_001")).resolves.toBeNull();
  });

  it("List the locales the site offers in registry order, its default among them", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      defaultLocale: "ko",
      supportedLocales: ["en", "ja"],
    });

    const info = await getTenantSiteInfo("TENANT_001");

    expect(info?.supportedLocales).toStrictEqual(["ja", "en", "ko"]);
  });

  it("refuses an offered locale this build serves no catalog for", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      supportedLocales: ["en", "fr"],
    });

    await expect(getTenantSiteInfo("TENANT_001")).resolves.toBeNull();
  });

  it("Return the locales the tenant offers", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    await expect(
      getTenantSupportedLocales("TENANT_001")
    ).resolves.toStrictEqual(["ja", "en"]);
  });

  it("reports an unreadable tenant instead of listing locales", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(getTenantSupportedLocales("TENANT_001")).rejects.toThrow(
      "tenant supported locales are unavailable"
    );
  });

  it("List no locales for the switcher while the tenant cannot be obtained", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(
      getTenantLinkSupportedLocales("TENANT_001")
    ).resolves.toBeNull();
  });

  it("reads the site copy in the reader's locale", async () => {
    mockGetTenant.mockResolvedValueOnce({
      ...tenantResponse,
      copyrightText: " © Example ",
      siteDescription: "Comics from Example.",
      siteTagline: "Read every week",
    });

    await expect(getTenantSiteCopy(" TENANT_001 ", "en")).resolves.toEqual({
      copyrightText: "© Example",
      siteDescription: "Comics from Example.",
      siteTagline: "Read every week",
    });
    expect(mockCacheTag).toHaveBeenCalledWith("tenant:TENANT_001:site");
    expect(mockGetTenant).toHaveBeenCalledWith({
      locale: "en",
      tenant: { tenantId: "TENANT_001" },
    });
  });

  it("leaves out site copy the tenant has not written", async () => {
    mockGetTenant.mockResolvedValueOnce(tenantResponse);

    await expect(getTenantSiteCopy("TENANT_001", "ja")).resolves.toEqual({
      copyrightText: "© Example",
      siteDescription: undefined,
      siteTagline: undefined,
    });
  });

  it("reads no site copy while the tenant cannot be obtained", async () => {
    mockGetTenant.mockRejectedValueOnce(
      new ConnectError("upstream is down", Code.Unavailable)
    );

    await expect(getTenantSiteCopy("TENANT_001", "en")).resolves.toEqual({});
  });
});
