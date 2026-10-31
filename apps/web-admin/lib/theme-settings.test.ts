import {
  BadRequestSchema,
  Code,
  ConnectError,
} from "@publira/api-client/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCacheLife,
  mockCacheTag,
  mockDeleteTenantDarkThemeApi,
  mockDeleteTenantIconApi,
  mockDeleteTenantLogoApi,
  mockDeleteTenantSignInImageApi,
  mockGetSessionId,
  mockGetTenantDarkThemeApi,
  mockGetTenantThemeApi,
  mockUploadTenantIconApi,
  mockUploadTenantLogoApi,
  mockUploadTenantSignInImageApi,
  mockUpsertTenantDarkThemeApi,
  mockUpsertTenantThemeApi,
} = vi.hoisted(() => ({
  mockCacheLife: vi.fn(),
  mockCacheTag: vi.fn(),
  mockDeleteTenantDarkThemeApi: vi.fn(),
  mockDeleteTenantIconApi: vi.fn(),
  mockDeleteTenantLogoApi: vi.fn(),
  mockDeleteTenantSignInImageApi: vi.fn(),
  mockGetSessionId: vi.fn(),
  mockGetTenantDarkThemeApi: vi.fn(),
  mockGetTenantThemeApi: vi.fn(),
  mockUploadTenantIconApi: vi.fn(),
  mockUploadTenantLogoApi: vi.fn(),
  mockUploadTenantSignInImageApi: vi.fn(),
  mockUpsertTenantDarkThemeApi: vi.fn(),
  mockUpsertTenantThemeApi: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: mockCacheLife,
  cacheTag: mockCacheTag,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetSessionId,
}));

vi.mock("@publira/api-client/admin/client", () => ({
  createAdminApiClient: () => ({
    theme: {
      deleteTenantDarkTheme: mockDeleteTenantDarkThemeApi,
      deleteTenantIcon: mockDeleteTenantIconApi,
      deleteTenantLogo: mockDeleteTenantLogoApi,
      deleteTenantSignInImage: mockDeleteTenantSignInImageApi,
      getTenantDarkTheme: mockGetTenantDarkThemeApi,
      getTenantTheme: mockGetTenantThemeApi,
      uploadTenantIcon: mockUploadTenantIconApi,
      uploadTenantLogo: mockUploadTenantLogoApi,
      uploadTenantSignInImage: mockUploadTenantSignInImageApi,
      upsertTenantDarkTheme: mockUpsertTenantDarkThemeApi,
      upsertTenantTheme: mockUpsertTenantThemeApi,
    },
  }),
}));

const brandingImageUpdatedAt = "2026-08-19T00:00:00.000Z";

/**
 * `file_size_bytes` is an int64, so the wire value is a `bigint` and the mapper
 * is what narrows it. A fixture that already held a `number` on both sides
 * never ran that conversion. (`BigInt(...)` rather than `1024n`: the app's
 * TypeScript target is ES2017, which has no bigint literal.)
 */
const brandingImageFileSizeBytes = 1024;

const brandingVariant = (variantType: string) => ({
  contentType: "image/png",
  height: 64,
  label: "original",
  variantType,
  width: 64,
});

/** The API answer for a stored branding image, with the URL the server built. */
const storedImageResponse = (url: string, variantType: string) => ({
  updatedAt: brandingImageUpdatedAt,
  variants: [
    {
      ...brandingVariant(variantType),
      fileSizeBytes: BigInt(brandingImageFileSizeBytes),
      url,
    },
  ],
});

/** What the mapper has to produce from it. */
const storedImage = (url: string, variantType: string) => ({
  updatedAt: brandingImageUpdatedAt,
  variants: [
    {
      ...brandingVariant(variantType),
      fileSizeBytes: brandingImageFileSizeBytes,
      url,
    },
  ],
});

const fullTheme = {
  accentColor: "#e3e9f5",
  accentForegroundColor: "#22407a",
  backgroundColor: "#f5f5f2",
  borderColor: "#d6d6d0",
  cardColor: "#ffffff",
  cardForegroundColor: "#1f1d1a",
  destructiveColor: "#8f1d1d",
  destructiveForegroundColor: "#ffffff",
  foregroundColor: "#1f1d1a",
  infoColor: "#2f5d8a",
  infoForegroundColor: "#ffffff",
  inputColor: "#cfcfc8",
  mutedColor: "#e8e8e3",
  mutedForegroundColor: "#5f5e59",
  popoverColor: "#ffffff",
  popoverForegroundColor: "#1f1d1a",
  primaryColor: "#2b4c8c",
  primaryForegroundColor: "#ffffff",
  ringColor: "#2b4c8c",
  sansFontFamily: "",
  secondaryColor: "#c63d17",
  secondaryForegroundColor: "#ffffff",
  serifFontFamily: "",
  successColor: "#2a6b3f",
  successForegroundColor: "#ffffff",
  surfaceColor: "#fafaf8",
  surfaceForegroundColor: "#1f1d1a",
  warningColor: "#8a5a0b",
  warningForegroundColor: "#ffffff",
};

const {
  sansFontFamily: _sans,
  serifFontFamily: _serif,
  ...fullColors
} = fullTheme;

const darkColors = {
  ...fullColors,
  backgroundColor: "#1f1d1a",
  foregroundColor: "#f5f5f2",
};

describe("theme-settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetSessionId.mockResolvedValue("session-token");
  });

  it("returns the settings on a successful theme fetch", async () => {
    mockGetTenantThemeApi.mockResolvedValueOnce({ theme: fullTheme });

    const { getTenantThemeSettings } = await import("./theme-settings");

    const result = await getTenantThemeSettings("TENANT001", "en");

    expect(result).toEqual({
      icon: null,
      logo: null,
      ok: true,
      signInImage: null,
      theme: fullTheme,
    });

    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:theme-settings"
    );
    expect(mockGetTenantThemeApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
    expect(mockCacheLife).not.toHaveBeenCalled();
  });

  it("returns an error when there is no session", async () => {
    mockGetSessionId.mockResolvedValue("");

    const { getTenantThemeSettings } = await import("./theme-settings");

    const result = await getTenantThemeSettings("TENANT001", "en");

    expect(result).toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantThemeApi).not.toHaveBeenCalled();
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("returns an error when the theme fetch fails", async () => {
    mockGetTenantThemeApi.mockRejectedValueOnce(
      new ConnectError("theme unavailable", Code.Unavailable)
    );

    const { getTenantThemeSettings } = await import("./theme-settings");

    const result = await getTenantThemeSettings("TENANT001", "en");

    expect(result).toMatchObject({ ok: false, requiresSignIn: false });
    expect(result).not.toHaveProperty("theme");
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  // The cache fill itself must not throw, or the request fails before any
  // boundary can render; the exported read throws once outside the scope.
  it("throws an error it cannot classify only outside the cache scope", async () => {
    mockGetTenantThemeApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { getTenantThemeSettings } = await import("./theme-settings");

    await expect(getTenantThemeSettings("TENANT001", "en")).rejects.toThrow(
      Error
    );
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("returns an invalid_argument error from an update as it is", async () => {
    mockUpsertTenantThemeApi.mockRejectedValueOnce(
      new ConnectError(
        "theme.primary_color must be a hex color",
        Code.InvalidArgument
      )
    );

    const { updateTenantThemeSettings } = await import("./theme-settings");

    const result = await updateTenantThemeSettings(
      {
        ...fullTheme,
        primaryColor: "#bad",
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message: "theme.primary_color must be a hex color",
      ok: false,
    });
  });

  it("returns the saved theme on a successful update", async () => {
    const updatedTheme = { ...fullTheme, primaryColor: "#1f6570" };
    mockUpsertTenantThemeApi.mockResolvedValueOnce({ theme: updatedTheme });

    const { updateTenantThemeSettings } = await import("./theme-settings");

    const result = await updateTenantThemeSettings(
      {
        ...updatedTheme,
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      icon: null,
      logo: null,
      ok: true,
      signInImage: null,
      theme: updatedTheme,
    });
  });

  it("returns the variants of the icon as well when one is set", async () => {
    const stored = storedImageResponse("/images/tenants/icon-1", "icon");
    mockGetTenantThemeApi.mockResolvedValueOnce({
      theme: {
        ...fullTheme,
        iconImageUpdatedAt: stored.updatedAt,
        iconImageVariants: stored.variants,
      },
    });

    const { getTenantThemeSettings } = await import("./theme-settings");

    const result = await getTenantThemeSettings("TENANT001", "en");

    expect(result).toEqual({
      icon: storedImage("/images/tenants/icon-1", "icon"),
      logo: null,
      ok: true,
      signInImage: null,
      theme: fullTheme,
    });
  });

  it("treats a variant with no dimensions as unset", async () => {
    // The preview lays the image out from the width and height it was saved
    // with, so letting a variant through without them would render an
    // invisible 0x0 image. Such a variant counts as unset.
    const stored = storedImageResponse("/images/tenants/icon-1", "icon");
    mockGetTenantThemeApi.mockResolvedValueOnce({
      theme: {
        ...fullTheme,
        iconImageUpdatedAt: stored.updatedAt,
        iconImageVariants: [{ ...stored.variants[0], height: 0, width: 0 }],
      },
    });

    const { getTenantThemeSettings } = await import("./theme-settings");

    const result = await getTenantThemeSettings("TENANT001", "en");

    expect(result).toEqual({
      icon: null,
      logo: null,
      ok: true,
      signInImage: null,
      theme: fullTheme,
    });
  });

  it("returns the variants after saving once the icon is uploaded", async () => {
    const stored = storedImageResponse("/images/tenants/icon-2", "icon");
    mockUploadTenantIconApi.mockResolvedValueOnce({
      theme: {
        ...fullTheme,
        iconImageUpdatedAt: stored.updatedAt,
        iconImageVariants: stored.variants,
      },
    });

    const { uploadTenantIcon } = await import("./theme-settings");

    const iconData = new Uint8Array([1, 2, 3]);

    const result = await uploadTenantIcon(
      {
        iconContentType: "image/png",
        iconData,
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      icon: storedImage("/images/tenants/icon-2", "icon"),
      ok: true,
    });
    expect(mockUploadTenantIconApi).toHaveBeenCalledWith(
      {
        iconContentType: "image/png",
        iconData,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("returns no variants once the icon is removed", async () => {
    mockDeleteTenantIconApi.mockResolvedValueOnce({ theme: fullTheme });

    const { deleteTenantIcon } = await import("./theme-settings");

    const result = await deleteTenantIcon("TENANT001", "en");

    expect(result).toEqual({ icon: null, ok: true });
    expect(mockDeleteTenantIconApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("does not pass the untranslated server message through when the icon is rejected", async () => {
    mockUploadTenantIconApi.mockRejectedValueOnce(
      new ConnectError(
        "icon image must be at least 32x32",
        Code.InvalidArgument
      )
    );

    const { uploadTenantIcon } = await import("./theme-settings");

    const result = await uploadTenantIcon(
      {
        iconContentType: "image/png",
        iconData: new Uint8Array([1]),
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.message).not.toContain("icon image must be at least");
    }
  });

  it("returns the variants of the logo as well when one is set", async () => {
    const stored = storedImageResponse("/images/tenants/logo-1", "logo");
    mockGetTenantThemeApi.mockResolvedValueOnce({
      theme: {
        ...fullTheme,
        logoImageUpdatedAt: stored.updatedAt,
        logoImageVariants: stored.variants,
      },
    });

    const { getTenantThemeSettings } = await import("./theme-settings");

    const result = await getTenantThemeSettings("TENANT001", "en");

    expect(result).toEqual({
      icon: null,
      logo: storedImage("/images/tenants/logo-1", "logo"),
      ok: true,
      signInImage: null,
      theme: fullTheme,
    });
  });

  it("returns the variants after saving once the logo is uploaded", async () => {
    const stored = storedImageResponse("/images/tenants/logo-2", "logo");
    mockUploadTenantLogoApi.mockResolvedValueOnce({
      theme: {
        ...fullTheme,
        logoImageUpdatedAt: stored.updatedAt,
        logoImageVariants: stored.variants,
      },
    });

    const { uploadTenantLogo } = await import("./theme-settings");

    const logoData = new Uint8Array([1, 2, 3]);

    const result = await uploadTenantLogo(
      {
        logoContentType: "image/png",
        logoData,
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      logo: storedImage("/images/tenants/logo-2", "logo"),
      ok: true,
    });
    expect(mockUploadTenantLogoApi).toHaveBeenCalledWith(
      {
        logoContentType: "image/png",
        logoData,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("returns no variants once the logo is removed", async () => {
    mockDeleteTenantLogoApi.mockResolvedValueOnce({ theme: fullTheme });

    const { deleteTenantLogo } = await import("./theme-settings");

    const result = await deleteTenantLogo("TENANT001", "en");

    expect(result).toEqual({ logo: null, ok: true });
    expect(mockDeleteTenantLogoApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("returns the variants of the shell logo when one is set", async () => {
    const stored = storedImageResponse("/images/tenants/logo-1", "logo");
    mockGetTenantThemeApi.mockResolvedValueOnce({
      theme: {
        ...fullTheme,
        logoImageUpdatedAt: stored.updatedAt,
        logoImageVariants: stored.variants,
      },
    });

    const { getTenantThemeLogo } = await import("./theme-settings");

    await expect(getTenantThemeLogo("TENANT001", "en")).resolves.toEqual(
      storedImage("/images/tenants/logo-1", "logo")
    );
  });

  it("gives null for the shell logo when none is set", async () => {
    mockGetTenantThemeApi.mockResolvedValueOnce({ theme: fullTheme });

    const { getTenantThemeLogo } = await import("./theme-settings");

    await expect(getTenantThemeLogo("TENANT001", "en")).resolves.toBeNull();
  });

  it("falls back to null for the shell logo when the theme fetch fails", async () => {
    mockGetTenantThemeApi.mockRejectedValueOnce(
      new ConnectError("boom", Code.Internal)
    );

    const { getTenantThemeLogo } = await import("./theme-settings");

    await expect(getTenantThemeLogo("TENANT001", "en")).resolves.toBeNull();
  });

  it("does not pass the untranslated server message through when the logo is rejected", async () => {
    mockUploadTenantLogoApi.mockRejectedValueOnce(
      new ConnectError(
        "logo image must be at least 32x32",
        Code.InvalidArgument
      )
    );

    const { uploadTenantLogo } = await import("./theme-settings");

    const result = await uploadTenantLogo(
      {
        logoContentType: "image/png",
        logoData: new Uint8Array([1]),
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.message).not.toContain("logo image must be at least");
    }
  });

  it("returns the variants of the sign-in image as well when one is set", async () => {
    const stored = storedImageResponse("/images/tenants/sign-in-1", "sign_in");
    mockGetTenantThemeApi.mockResolvedValueOnce({
      theme: {
        ...fullTheme,
        signInImageUpdatedAt: stored.updatedAt,
        signInImageVariants: stored.variants,
      },
    });

    const { getTenantThemeSettings } = await import("./theme-settings");

    const result = await getTenantThemeSettings("TENANT001", "en");

    expect(result).toEqual({
      icon: null,
      logo: null,
      ok: true,
      signInImage: storedImage("/images/tenants/sign-in-1", "sign_in"),
      theme: fullTheme,
    });
  });

  it("returns the variants after saving once the sign-in image is uploaded", async () => {
    const stored = storedImageResponse("/images/tenants/sign-in-2", "sign_in");
    mockUploadTenantSignInImageApi.mockResolvedValueOnce({
      theme: {
        ...fullTheme,
        signInImageUpdatedAt: stored.updatedAt,
        signInImageVariants: stored.variants,
      },
    });

    const { uploadTenantSignInImage } = await import("./theme-settings");

    const imageData = new Uint8Array([1, 2, 3]);

    const result = await uploadTenantSignInImage(
      {
        imageContentType: "image/jpeg",
        imageData,
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      ok: true,
      signInImage: storedImage("/images/tenants/sign-in-2", "sign_in"),
    });
    expect(mockUploadTenantSignInImageApi).toHaveBeenCalledWith(
      {
        imageContentType: "image/jpeg",
        imageData,
        tenant: { tenantId: "TENANT001" },
      },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("returns no variants once the sign-in image is removed", async () => {
    mockDeleteTenantSignInImageApi.mockResolvedValueOnce({ theme: fullTheme });

    const { deleteTenantSignInImage } = await import("./theme-settings");

    const result = await deleteTenantSignInImage("TENANT001", "en");

    expect(result).toEqual({ ok: true, signInImage: null });
    expect(mockDeleteTenantSignInImageApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("words a rejected sign-in image with the size the screen asks for", async () => {
    mockUploadTenantSignInImageApi.mockRejectedValueOnce(
      new ConnectError(
        "sign-in image must be at least 512x512 after scaling to 2560px on its longest edge, got 600x300",
        Code.InvalidArgument,
        undefined,
        [
          {
            desc: BadRequestSchema,
            value: { fieldViolations: [{ field: "image_data" }] },
          },
        ]
      )
    );

    const { uploadTenantSignInImage } = await import("./theme-settings");

    const result = await uploadTenantSignInImage(
      {
        imageContentType: "image/png",
        imageData: new Uint8Array([1]),
        tenantId: "TENANT001",
      },
      "en"
    );

    expect(result).toEqual({
      message:
        "The image could not be read. Choose a JPEG, PNG, or WebP whose shorter side is at least 512px.",
      ok: false,
    });
  });
  it("returns null for a tenant with no dark palette", async () => {
    mockGetTenantDarkThemeApi.mockResolvedValueOnce({});

    const { getTenantDarkThemeSettings } = await import("./theme-settings");

    await expect(
      getTenantDarkThemeSettings("TENANT001", "en")
    ).resolves.toEqual({ darkTheme: null, ok: true });
    expect(mockCacheTag).toHaveBeenCalledWith(
      "tenant:TENANT001:theme-settings"
    );
    expect(mockGetTenantDarkThemeApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("returns the colors of a saved dark palette", async () => {
    mockGetTenantDarkThemeApi.mockResolvedValueOnce({
      darkTheme: { ...darkColors, primaryColor: "#8FB0F0" },
    });

    const { getTenantDarkThemeSettings } = await import("./theme-settings");

    await expect(
      getTenantDarkThemeSettings("TENANT001", "en")
    ).resolves.toEqual({
      darkTheme: { ...darkColors, primaryColor: "#8fb0f0" },
      ok: true,
    });
  });

  // A server of the release before this console has no GetTenantDarkTheme, and
  // the rest of the branding screen has to stay usable against it.
  it("answers a dark palette read the server does not implement without throwing", async () => {
    mockGetTenantDarkThemeApi.mockRejectedValueOnce(
      new ConnectError("not implemented", Code.Unimplemented)
    );

    const { getTenantDarkThemeSettings } = await import("./theme-settings");

    await expect(
      getTenantDarkThemeSettings("TENANT001", "en")
    ).resolves.toMatchObject({ ok: false, requiresSignIn: false });
    expect(mockCacheLife).toHaveBeenCalledWith({
      expire: 0,
      revalidate: 0,
      stale: 0,
    });
  });

  it("asks for a sign-in when the dark palette is read without a session", async () => {
    mockGetSessionId.mockResolvedValue("");

    const { getTenantDarkThemeSettings } = await import("./theme-settings");

    await expect(
      getTenantDarkThemeSettings("TENANT001", "en")
    ).resolves.toEqual({
      message: "Your session is no longer valid. Please sign in again.",
      ok: false,
      requiresSignIn: true,
    });
    expect(mockGetTenantDarkThemeApi).not.toHaveBeenCalled();
  });

  it("sends the dark palette's colors and returns the ones stored", async () => {
    mockUpsertTenantDarkThemeApi.mockResolvedValueOnce({
      darkTheme: darkColors,
    });

    const { updateTenantDarkThemeSettings } = await import("./theme-settings");

    const result = await updateTenantDarkThemeSettings(
      { ...darkColors, tenantId: "TENANT001" },
      "en"
    );

    expect(result).toEqual({ darkTheme: darkColors, ok: true });
    expect(mockUpsertTenantDarkThemeApi).toHaveBeenCalledWith(
      { darkTheme: darkColors, tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });

  it("returns an invalid_argument error from a dark palette save as it is", async () => {
    mockUpsertTenantDarkThemeApi.mockRejectedValueOnce(
      new ConnectError(
        "dark_theme.primary_color must be a hex color",
        Code.InvalidArgument
      )
    );

    const { updateTenantDarkThemeSettings } = await import("./theme-settings");

    await expect(
      updateTenantDarkThemeSettings(
        { ...darkColors, tenantId: "TENANT001" },
        "en"
      )
    ).resolves.toEqual({
      message: "dark_theme.primary_color must be a hex color",
      ok: false,
    });
  });

  it("returns no dark palette once it is deleted", async () => {
    mockDeleteTenantDarkThemeApi.mockResolvedValueOnce({});

    const { deleteTenantDarkThemeSettings } = await import("./theme-settings");

    await expect(
      deleteTenantDarkThemeSettings("TENANT001", "en")
    ).resolves.toEqual({ darkTheme: null, ok: true });
    expect(mockDeleteTenantDarkThemeApi).toHaveBeenCalledWith(
      { tenant: { tenantId: "TENANT001" } },
      { headers: { Authorization: "Bearer session-token" } }
    );
  });
});
