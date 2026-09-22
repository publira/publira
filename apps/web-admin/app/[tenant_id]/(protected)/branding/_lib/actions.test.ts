import { DEFAULT_TENANT_THEME_COLORS } from "@publira/utils/theme-css-variables";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAssertSameOrigin,
  mockDeleteTenantIcon,
  mockDeleteTenantLogo,
  mockGetAccessToken,
  mockUpdateTag,
  mockUpdateTenantThemeSettings,
  mockUploadTenantIcon,
  mockUploadTenantLogo,
} = vi.hoisted(() => ({
  mockAssertSameOrigin: vi.fn(),
  mockDeleteTenantIcon: vi.fn(),
  mockDeleteTenantLogo: vi.fn(),
  mockGetAccessToken: vi.fn(),
  mockUpdateTag: vi.fn(),
  mockUpdateTenantThemeSettings: vi.fn(),
  mockUploadTenantIcon: vi.fn(),
  mockUploadTenantLogo: vi.fn(),
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

vi.mock("#lib/theme-settings", () => ({
  deleteTenantIcon: mockDeleteTenantIcon,
  deleteTenantLogo: mockDeleteTenantLogo,
  tenantThemeCacheTag: (tenantId: string) =>
    `tenant:${tenantId}:theme-settings`,
  updateTenantThemeSettings: mockUpdateTenantThemeSettings,
  uploadTenantIcon: mockUploadTenantIcon,
  uploadTenantLogo: mockUploadTenantLogo,
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
      icon: storedImage("/images/tenants/icon-1"),
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
      icon: null,
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
      logo: storedImage("/images/tenants/logo-1"),
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
      logo: null,
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
