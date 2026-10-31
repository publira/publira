import { DEFAULT_TENANT_THEME_COLORS } from "@publira/utils/theme-css-variables";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockDeleteTenantBrandMark,
  mockDeleteTenantDarkThemeSettings,
  mockDeleteTenantIcon,
  mockDeleteTenantLogo,
  mockDeleteTenantSignInImage,
  mockGetAccessToken,
  mockUpdateTag,
  mockUpdateTenantDarkThemeSettings,
  mockUpdateTenantThemeSettings,
  mockUploadTenantBrandMark,
  mockUploadTenantIcon,
  mockUploadTenantLogo,
  mockUploadTenantSignInImage,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockDeleteTenantBrandMark: vi.fn(),
  mockDeleteTenantDarkThemeSettings: vi.fn(),
  mockDeleteTenantIcon: vi.fn(),
  mockDeleteTenantLogo: vi.fn(),
  mockDeleteTenantSignInImage: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUpdateTenantDarkThemeSettings: vi.fn(),
  mockUpdateTenantThemeSettings: vi.fn(),
  mockUploadTenantBrandMark: vi.fn(),
  mockUploadTenantIcon: vi.fn(),
  mockUploadTenantLogo: vi.fn(),
  mockUploadTenantSignInImage: vi.fn(),
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

vi.mock("#lib/brand-marks", () => ({
  BRAND_MARK_KINDS: [
    "x_share",
    "line_share",
    "app_store_badge",
    "google_play_badge",
    "apple_sign_in",
    "google_sign_in",
  ],
  deleteTenantBrandMark: mockDeleteTenantBrandMark,
  tenantBrandMarksCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:brand-marks`,
  uploadTenantBrandMark: mockUploadTenantBrandMark,
}));

vi.mock("#lib/theme-settings", () => ({
  deleteTenantDarkThemeSettings: mockDeleteTenantDarkThemeSettings,
  deleteTenantIcon: mockDeleteTenantIcon,
  deleteTenantLogo: mockDeleteTenantLogo,
  deleteTenantSignInImage: mockDeleteTenantSignInImage,
  tenantThemeCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:theme-settings`,
  updateTenantDarkThemeSettings: mockUpdateTenantDarkThemeSettings,
  updateTenantThemeSettings: mockUpdateTenantThemeSettings,
  uploadTenantIcon: mockUploadTenantIcon,
  uploadTenantLogo: mockUploadTenantLogo,
  uploadTenantSignInImage: mockUploadTenantSignInImage,
}));

const textFormData = (values: Record<string, string>): FormData => {
  const formData = new FormData();

  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }

  return formData;
};

const themeFormData = (
  colors = DEFAULT_TENANT_THEME_COLORS,
  fontFamilies?: { sansFontFamily: string; serifFontFamily: string }
): FormData =>
  textFormData({
    tenant_id: "TENANT001",
    ...Object.fromEntries(
      Object.entries(colors).map(([key, value]) => [
        key.replaceAll(/[A-Z]/gu, (character) => `_${character.toLowerCase()}`),
        value,
      ])
    ),
    sans_font_family: fontFamilies?.sansFontFamily ?? "",
    serif_font_family: fontFamilies?.serifFontFamily ?? "",
  });

// Evaluating the Actions' module graph for the first time takes far longer than
// any test's own work, so it is paid here rather than inside one test's timeout.
beforeAll(async () => {
  await import("./actions");
});

describe("updateTenantThemeSettingsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("keeps a low-contrast color pair out of the API and shows the reason on both fields", async () => {
    const { updateTenantThemeSettingsAction } = await import("./actions");

    const result = await updateTenantThemeSettingsAction(
      null,
      themeFormData({
        ...DEFAULT_TENANT_THEME_COLORS,
        primaryForegroundColor: DEFAULT_TENANT_THEME_COLORS.primaryColor,
      })
    );

    const message =
      "The contrast ratio between Primary color and Primary text color must be at least 4.5:1 (currently 1.00:1).";

    expect(result).toEqual({
      fieldErrors: {
        primaryColor: message,
        primaryForegroundColor: message,
      },
      message: "Check these color pairs so the text stays readable.",
      ok: false,
    });
    expect(mockUpdateTenantThemeSettings).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("saves the default colors", async () => {
    mockUpdateTenantThemeSettings.mockResolvedValueOnce({
      icon: null,
      logo: null,
      ok: true,
      signInImage: null,
      theme: DEFAULT_TENANT_THEME_COLORS,
    });

    const { updateTenantThemeSettingsAction } = await import("./actions");

    const result = await updateTenantThemeSettingsAction(null, themeFormData());

    expect(result).toEqual({
      message: "The theme was saved.",
      ok: true,
      theme: DEFAULT_TENANT_THEME_COLORS,
    });
    expect(mockUpdateTenantThemeSettings).toHaveBeenCalledWith(
      {
        ...DEFAULT_TENANT_THEME_COLORS,
        sansFontFamily: "",
        serifFontFamily: "",
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:site");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:theme-settings"
    );
  });

  it("keeps an unsafe font family out of the API", async () => {
    const { updateTenantThemeSettingsAction } = await import("./actions");

    const result = await updateTenantThemeSettingsAction(
      null,
      themeFormData(DEFAULT_TENANT_THEME_COLORS, {
        sansFontFamily: "Noto Sans, sans-serif",
        serifFontFamily: "Noto Serif; color: red",
      })
    );

    expect(result).toMatchObject({
      fieldErrors: {
        serifFontFamily:
          "Enter a comma-separated list of font family names only.",
      },
      message: "Please check the information you entered.",
      ok: false,
    });
    expect(mockUpdateTenantThemeSettings).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

/** A dark palette that passes the contrast check: the defaults' ink on paper. */
const DARK_COLORS = {
  ...DEFAULT_TENANT_THEME_COLORS,
  backgroundColor: "#1f1d1a",
  foregroundColor: "#f5f5f2",
};

describe("updateTenantDarkThemeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("saves the colors alone and revalidates the public site and the screen", async () => {
    mockUpdateTenantDarkThemeSettings.mockResolvedValueOnce({
      darkTheme: DARK_COLORS,
      ok: true,
    });

    const { updateTenantDarkThemeAction } = await import("./actions");

    const result = await updateTenantDarkThemeAction(
      null,
      themeFormData(DARK_COLORS)
    );

    expect(result).toEqual({
      darkTheme: DARK_COLORS,
      message: "The dark palette was saved.",
      ok: true,
    });
    // The dark palette has no typefaces, so the posted stacks are not sent.
    expect(mockUpdateTenantDarkThemeSettings).toHaveBeenCalledWith(
      { ...DARK_COLORS, tenantId: "TENANT001" },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:site");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:theme-settings"
    );
  });

  it("holds the dark palette to the light palette's contrast check", async () => {
    const { updateTenantDarkThemeAction } = await import("./actions");

    const result = await updateTenantDarkThemeAction(
      null,
      themeFormData({ ...DARK_COLORS, foregroundColor: "#2a2825" })
    );

    expect(result).toMatchObject({
      fieldErrors: {
        backgroundColor: expect.stringContaining(
          "Background color and Text color"
        ),
        foregroundColor: expect.stringContaining(
          "Background color and Text color"
        ),
      },
      message: "Check these color pairs so the text stays readable.",
      ok: false,
    });
    expect(mockUpdateTenantDarkThemeSettings).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("keeps a color that is not #RRGGBB out of the API", async () => {
    const { updateTenantDarkThemeAction } = await import("./actions");

    const result = await updateTenantDarkThemeAction(
      null,
      themeFormData({ ...DARK_COLORS, primaryColor: "blue" })
    );

    expect(result).toMatchObject({
      fieldErrors: { primaryColor: "Enter a color in #RRGGBB form." },
      ok: false,
    });
    expect(mockUpdateTenantDarkThemeSettings).not.toHaveBeenCalled();
  });

  it("leaves the cache alone when the save fails", async () => {
    mockUpdateTenantDarkThemeSettings.mockResolvedValueOnce({
      message: "Could not save the dark palette. Please try again later.",
      ok: false,
    });

    const { updateTenantDarkThemeAction } = await import("./actions");

    const result = await updateTenantDarkThemeAction(
      null,
      themeFormData(DARK_COLORS)
    );

    expect(result).toEqual({
      message: "Could not save the dark palette. Please try again later.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("refuses a tenant ID posted as a file", async () => {
    const formData = themeFormData(DARK_COLORS);
    formData.set("tenant_id", new File(["TENANT001"], "tenant.txt"));

    const { updateTenantDarkThemeAction } = await import("./actions");

    const result = await updateTenantDarkThemeAction(null, formData);

    expect(result).toEqual({
      message: "The tenant ID is missing.",
      ok: false,
    });
    expect(mockUpdateTenantDarkThemeSettings).not.toHaveBeenCalled();
  });
});

describe("deleteTenantDarkThemeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("deletes the dark palette and revalidates the public site and the screen", async () => {
    mockDeleteTenantDarkThemeSettings.mockResolvedValueOnce({
      darkTheme: null,
      ok: true,
    });

    const { deleteTenantDarkThemeAction } = await import("./actions");

    const result = await deleteTenantDarkThemeAction(
      null,
      textFormData({ tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      darkTheme: null,
      message: "The dark palette was deleted.",
      ok: true,
    });
    expect(mockDeleteTenantDarkThemeSettings).toHaveBeenCalledWith(
      "TENANT001",
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:site");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:theme-settings"
    );
  });

  it("does not call the API without a tenant", async () => {
    const { deleteTenantDarkThemeAction } = await import("./actions");

    const result = await deleteTenantDarkThemeAction(null, textFormData({}));

    expect(result).toEqual({
      message: "The tenant ID is missing.",
      ok: false,
    });
    expect(mockDeleteTenantDarkThemeSettings).not.toHaveBeenCalled();
  });

  it("refuses a tenant ID posted as a file", async () => {
    const formData = new FormData();
    formData.set("tenant_id", new File(["TENANT001"], "tenant.txt"));

    const { deleteTenantDarkThemeAction } = await import("./actions");

    const result = await deleteTenantDarkThemeAction(null, formData);

    expect(result).toEqual({
      message: "The tenant ID is missing.",
      ok: false,
    });
    expect(mockDeleteTenantDarkThemeSettings).not.toHaveBeenCalled();
  });
});

const iconFormData = (
  values: Record<string, string>,
  file?: File
): FormData => {
  const formData = new FormData();

  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }

  if (file) {
    formData.set("icon", file);
  }

  return formData;
};

const storedImage = (url: string) => ({
  updatedAt: "2026-08-19T00:00:00.000Z",
  variants: [
    {
      contentType: "image/png",
      fileSizeBytes: 1024,
      height: 64,
      label: "original",
      url,
      variantType: "icon",
      width: 64,
    },
  ],
});

const pngFile = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "icon.png", {
    type: "image/png",
  });

/** Only the reported size matters to the schema, so the bytes stay cheap. */
const oversizedPngFile = () => {
  const file = pngFile();
  Object.defineProperty(file, "size", { value: 10 * 1024 * 1024 + 1 });

  return file;
};

describe("updateTenantIconAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("uploads the chosen image and revalidates the cache of the public site and the settings screen", async () => {
    mockUploadTenantIcon.mockResolvedValueOnce({
      icon: storedImage("/images/tenants/icon-1"),
      ok: true,
    });

    const { updateTenantIconAction } = await import("./actions");

    const result = await updateTenantIconAction(
      null,
      iconFormData({ intent: "upload", tenant_id: "TENANT001" }, pngFile())
    );

    expect(result).toEqual({
      message: "The icon was saved.",
      ok: true,
    });
    expect(mockUploadTenantIcon).toHaveBeenCalledWith(
      {
        iconContentType: "image/png",
        iconData: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:site");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:theme-settings"
    );
  });

  it("calls the delete API without sending an image on removal", async () => {
    mockDeleteTenantIcon.mockResolvedValueOnce({ icon: null, ok: true });

    const { updateTenantIconAction } = await import("./actions");

    const result = await updateTenantIconAction(
      null,
      iconFormData({ intent: "delete", tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      message: "The icon was deleted.",
      ok: true,
    });
    expect(mockDeleteTenantIcon).toHaveBeenCalledWith("TENANT001", "en");
    expect(mockUploadTenantIcon).not.toHaveBeenCalled();
  });

  it("does not call the API when uploading without choosing an image", async () => {
    const { updateTenantIconAction } = await import("./actions");

    const result = await updateTenantIconAction(
      null,
      iconFormData({ intent: "upload", tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      message: "Select an image file.",
      ok: false,
    });
    expect(mockUploadTenantIcon).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("rejects a file over the size limit without reading it", async () => {
    const file = oversizedPngFile();
    const arrayBuffer = vi.spyOn(file, "arrayBuffer");

    const { updateTenantIconAction } = await import("./actions");

    const result = await updateTenantIconAction(
      null,
      iconFormData({ intent: "upload", tenant_id: "TENANT001" }, file)
    );

    expect(result).toEqual({
      message: "The image must be 10MB or smaller.",
      ok: false,
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(mockUploadTenantIcon).not.toHaveBeenCalled();
  });

  it("rejects a file whose MIME type is not accepted", async () => {
    const file = new File([new Uint8Array([1])], "icon.svg", {
      type: "image/svg+xml",
    });

    const { updateTenantIconAction } = await import("./actions");

    const result = await updateTenantIconAction(
      null,
      iconFormData({ intent: "upload", tenant_id: "TENANT001" }, file)
    );

    expect(result).toEqual({
      message: "Select a JPEG, PNG, or WebP image.",
      ok: false,
    });
    expect(mockUploadTenantIcon).not.toHaveBeenCalled();
  });

  it("leaves the cache alone when the upload fails", async () => {
    mockUploadTenantIcon.mockResolvedValueOnce({
      message: "Could not upload the icon.",
      ok: false,
    });

    const { updateTenantIconAction } = await import("./actions");

    const result = await updateTenantIconAction(
      null,
      iconFormData({ intent: "upload", tenant_id: "TENANT001" }, pngFile())
    );

    expect(result).toEqual({
      message: "Could not upload the icon.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

const logoFormData = (
  values: Record<string, string>,
  file?: File
): FormData => {
  const formData = new FormData();

  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }

  if (file) {
    formData.set("logo", file);
  }

  return formData;
};

describe("updateTenantLogoAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("uploads the chosen image and revalidates the cache of the public site and the settings screen", async () => {
    mockUploadTenantLogo.mockResolvedValueOnce({
      logo: storedImage("/images/tenants/logo-1"),
      ok: true,
    });

    const { updateTenantLogoAction } = await import("./actions");

    const result = await updateTenantLogoAction(
      null,
      logoFormData({ intent: "upload", tenant_id: "TENANT001" }, pngFile())
    );

    expect(result).toEqual({
      message: "The logo was saved.",
      ok: true,
    });
    expect(mockUploadTenantLogo).toHaveBeenCalledWith(
      {
        logoContentType: "image/png",
        logoData: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:site");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:theme-settings"
    );
  });

  it("calls the delete API without sending an image on removal", async () => {
    mockDeleteTenantLogo.mockResolvedValueOnce({ logo: null, ok: true });

    const { updateTenantLogoAction } = await import("./actions");

    const result = await updateTenantLogoAction(
      null,
      logoFormData({ intent: "delete", tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      message: "The logo was deleted.",
      ok: true,
    });
    expect(mockDeleteTenantLogo).toHaveBeenCalledWith("TENANT001", "en");
    expect(mockUploadTenantLogo).not.toHaveBeenCalled();
  });

  it("does not call the API when uploading without choosing an image", async () => {
    const { updateTenantLogoAction } = await import("./actions");

    const result = await updateTenantLogoAction(
      null,
      logoFormData({ intent: "upload", tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      message: "Select an image file.",
      ok: false,
    });
    expect(mockUploadTenantLogo).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("rejects a file over the size limit without reading it", async () => {
    const file = oversizedPngFile();
    const arrayBuffer = vi.spyOn(file, "arrayBuffer");

    const { updateTenantLogoAction } = await import("./actions");

    const result = await updateTenantLogoAction(
      null,
      logoFormData({ intent: "upload", tenant_id: "TENANT001" }, file)
    );

    expect(result).toEqual({
      message: "The image must be 10MB or smaller.",
      ok: false,
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(mockUploadTenantLogo).not.toHaveBeenCalled();
  });

  it("rejects a file whose MIME type is not accepted", async () => {
    const file = new File([new Uint8Array([1])], "logo.svg", {
      type: "image/svg+xml",
    });

    const { updateTenantLogoAction } = await import("./actions");

    const result = await updateTenantLogoAction(
      null,
      logoFormData({ intent: "upload", tenant_id: "TENANT001" }, file)
    );

    expect(result).toEqual({
      message: "Select a JPEG, PNG, or WebP image.",
      ok: false,
    });
    expect(mockUploadTenantLogo).not.toHaveBeenCalled();
  });

  it("leaves the cache alone when the upload fails", async () => {
    mockUploadTenantLogo.mockResolvedValueOnce({
      message: "Could not upload the logo.",
      ok: false,
    });

    const { updateTenantLogoAction } = await import("./actions");

    const result = await updateTenantLogoAction(
      null,
      logoFormData({ intent: "upload", tenant_id: "TENANT001" }, pngFile())
    );

    expect(result).toEqual({
      message: "Could not upload the logo.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

const signInImageFormData = (
  values: Record<string, string>,
  file?: File
): FormData => {
  const formData = new FormData();

  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }

  if (file) {
    formData.set("sign_in_image", file);
  }

  return formData;
};

describe("updateTenantSignInImageAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("uploads the chosen image and revalidates the cache of the public site and the settings screen", async () => {
    mockUploadTenantSignInImage.mockResolvedValueOnce({
      ok: true,
      signInImage: storedImage("/images/tenants/sign-in-1"),
    });

    const { updateTenantSignInImageAction } = await import("./actions");

    const result = await updateTenantSignInImageAction(
      null,
      signInImageFormData(
        { intent: "upload", tenant_id: "TENANT001" },
        pngFile()
      )
    );

    expect(result).toEqual({
      message: "The sign-in image was saved.",
      ok: true,
    });
    expect(mockUploadTenantSignInImage).toHaveBeenCalledWith(
      {
        imageContentType: "image/png",
        imageData: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        tenantId: "TENANT001",
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:site");
    expect(mockUpdateTag).toHaveBeenCalledWith(
      "tenant:TENANT001:theme-settings"
    );
  });

  it("calls the delete API without sending an image on removal", async () => {
    mockDeleteTenantSignInImage.mockResolvedValueOnce({
      ok: true,
      signInImage: null,
    });

    const { updateTenantSignInImageAction } = await import("./actions");

    const result = await updateTenantSignInImageAction(
      null,
      signInImageFormData({ intent: "delete", tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      message: "The sign-in image was deleted.",
      ok: true,
    });
    expect(mockDeleteTenantSignInImage).toHaveBeenCalledWith("TENANT001", "en");
    expect(mockUploadTenantSignInImage).not.toHaveBeenCalled();
  });

  it("does not call the API when uploading without choosing an image", async () => {
    const { updateTenantSignInImageAction } = await import("./actions");

    const result = await updateTenantSignInImageAction(
      null,
      signInImageFormData({ intent: "upload", tenant_id: "TENANT001" })
    );

    expect(result).toEqual({
      message: "Select an image file.",
      ok: false,
    });
    expect(mockUploadTenantSignInImage).not.toHaveBeenCalled();
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });

  it("rejects a file over the size limit without reading it", async () => {
    const file = oversizedPngFile();
    const arrayBuffer = vi.spyOn(file, "arrayBuffer");

    const { updateTenantSignInImageAction } = await import("./actions");

    const result = await updateTenantSignInImageAction(
      null,
      signInImageFormData({ intent: "upload", tenant_id: "TENANT001" }, file)
    );

    expect(result).toEqual({
      message: "The image must be 10MB or smaller.",
      ok: false,
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(mockUploadTenantSignInImage).not.toHaveBeenCalled();
  });

  it("rejects a file whose MIME type is not accepted", async () => {
    const file = new File([new Uint8Array([1])], "sign-in.svg", {
      type: "image/svg+xml",
    });

    const { updateTenantSignInImageAction } = await import("./actions");

    const result = await updateTenantSignInImageAction(
      null,
      signInImageFormData({ intent: "upload", tenant_id: "TENANT001" }, file)
    );

    expect(result).toEqual({
      message: "Select a JPEG, PNG, or WebP image.",
      ok: false,
    });
    expect(mockUploadTenantSignInImage).not.toHaveBeenCalled();
  });

  it("leaves the cache alone when the upload fails", async () => {
    mockUploadTenantSignInImage.mockResolvedValueOnce({
      message: "Could not upload the sign-in image.",
      ok: false,
    });

    const { updateTenantSignInImageAction } = await import("./actions");

    const result = await updateTenantSignInImageAction(
      null,
      signInImageFormData(
        { intent: "upload", tenant_id: "TENANT001" },
        pngFile()
      )
    );

    expect(result).toEqual({
      message: "Could not upload the sign-in image.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});

const brandMarkFormData = (
  values: Record<string, string>,
  file?: File
): FormData => {
  const formData = new FormData();

  for (const [name, value] of Object.entries(values)) {
    formData.set(name, value);
  }

  if (file) {
    formData.set("image", file);
  }

  return formData;
};

const BRAND_MARK_TERMS_URL = "https://example.com/brand/guidelines";

describe("updateTenantBrandMarkAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGetAccessToken.mockResolvedValue("session-token");
  });

  it("uploads the chosen image with the guidelines shown and revalidates the public site and the screen", async () => {
    mockUploadTenantBrandMark.mockResolvedValueOnce({ mark: null, ok: true });

    const { updateTenantBrandMarkAction } = await import("./actions");

    const result = await updateTenantBrandMarkAction(
      null,
      brandMarkFormData(
        {
          intent: "upload",
          kind: "line_share",
          tenant_id: "TENANT001",
          terms_accepted: "true",
          terms_url: BRAND_MARK_TERMS_URL,
        },
        pngFile()
      )
    );

    expect(result).toEqual({ message: "The mark was uploaded.", ok: true });
    expect(mockUploadTenantBrandMark).toHaveBeenCalledWith(
      {
        imageContentType: "image/png",
        imageData: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        kind: "line_share",
        tenantId: "TENANT001",
        termsUrl: BRAND_MARK_TERMS_URL,
      },
      "en"
    );
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:site");
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:brand-marks");
  });

  it("does not read or send the image until the guidelines are accepted", async () => {
    const file = pngFile();
    const arrayBuffer = vi.spyOn(file, "arrayBuffer");

    const { updateTenantBrandMarkAction } = await import("./actions");

    const result = await updateTenantBrandMarkAction(
      null,
      brandMarkFormData(
        {
          intent: "upload",
          kind: "x_share",
          tenant_id: "TENANT001",
          terms_url: BRAND_MARK_TERMS_URL,
        },
        file
      )
    );

    expect(result).toEqual({
      message: "Accept the owner's guidelines before you upload the mark.",
      ok: false,
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(mockUploadTenantBrandMark).not.toHaveBeenCalled();
  });

  it("refuses guidelines that are not an https page", async () => {
    const { updateTenantBrandMarkAction } = await import("./actions");

    const result = await updateTenantBrandMarkAction(
      null,
      brandMarkFormData(
        {
          intent: "upload",
          kind: "x_share",
          tenant_id: "TENANT001",
          terms_accepted: "true",
          terms_url: "http://example.com/brand/guidelines",
        },
        pngFile()
      )
    );

    expect(result).toEqual({
      message: "Accept the owner's guidelines before you upload the mark.",
      ok: false,
    });
    expect(mockUploadTenantBrandMark).not.toHaveBeenCalled();
  });

  it("refuses a kind the console does not offer", async () => {
    const { updateTenantBrandMarkAction } = await import("./actions");

    const result = await updateTenantBrandMarkAction(
      null,
      brandMarkFormData({
        intent: "delete",
        kind: "facebook_share",
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({
      message: "This mark cannot be uploaded.",
      ok: false,
    });
    expect(mockDeleteTenantBrandMark).not.toHaveBeenCalled();
  });

  it("deletes the mark without asking for the guidelines or an image", async () => {
    mockDeleteTenantBrandMark.mockResolvedValueOnce({ mark: null, ok: true });

    const { updateTenantBrandMarkAction } = await import("./actions");

    const result = await updateTenantBrandMarkAction(
      null,
      brandMarkFormData({
        intent: "delete",
        kind: "apple_sign_in",
        tenant_id: "TENANT001",
      })
    );

    expect(result).toEqual({ message: "The mark was deleted.", ok: true });
    expect(mockDeleteTenantBrandMark).toHaveBeenCalledWith(
      "TENANT001",
      "apple_sign_in",
      "en"
    );
    expect(mockUploadTenantBrandMark).not.toHaveBeenCalled();
    expect(mockUpdateTag).toHaveBeenCalledWith("tenant:TENANT001:brand-marks");
  });

  it("leaves the cache alone when the upload fails", async () => {
    mockUploadTenantBrandMark.mockResolvedValueOnce({
      message: "Could not upload the mark. Please try again later.",
      ok: false,
    });

    const { updateTenantBrandMarkAction } = await import("./actions");

    const result = await updateTenantBrandMarkAction(
      null,
      brandMarkFormData(
        {
          intent: "upload",
          kind: "google_play_badge",
          tenant_id: "TENANT001",
          terms_accepted: "true",
          terms_url: BRAND_MARK_TERMS_URL,
        },
        pngFile()
      )
    );

    expect(result).toEqual({
      message: "Could not upload the mark. Please try again later.",
      ok: false,
    });
    expect(mockUpdateTag).not.toHaveBeenCalled();
  });
});
