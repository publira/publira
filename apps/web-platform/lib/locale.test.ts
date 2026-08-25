import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCookies, mockGetPlatformDisplayLocale } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetPlatformDisplayLocale: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("./platform-settings", () => ({
  getPlatformDisplayLocale: mockGetPlatformDisplayLocale,
}));

const setLocaleCookie = (value?: string) => {
  mockCookies.mockResolvedValue({
    get: (name: string) =>
      name === "publira_locale" && value !== undefined
        ? { name, value }
        : undefined,
  });
};

const importLocale = () => import("./locale");

describe("web-platform locale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    setLocaleCookie();
    mockGetPlatformDisplayLocale.mockResolvedValue("ja");
  });

  describe("getPlatformLocale", () => {
    it("falls back to the platform default locale when the cookie is not set", async () => {
      mockGetPlatformDisplayLocale.mockResolvedValue("en");
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("en");
    });

    it("falls back to ja when the platform default cannot be read", async () => {
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("ja");
    });

    it("keeps a cookie of ja instead of falling through to the platform default", async () => {
      mockGetPlatformDisplayLocale.mockResolvedValue("en");
      setLocaleCookie("ja");
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("ja");
      expect(mockGetPlatformDisplayLocale).not.toHaveBeenCalled();
    });

    it("returns the locale stored in the cookie", async () => {
      mockGetPlatformDisplayLocale.mockResolvedValue("ja");
      setLocaleCookie("en");
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("en");
      expect(mockGetPlatformDisplayLocale).not.toHaveBeenCalled();
    });

    it("trims surrounding whitespace in the cookie value", async () => {
      setLocaleCookie("  en  ");
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("en");
    });

    it("falls back to the platform default for an unsupported cookie value", async () => {
      mockGetPlatformDisplayLocale.mockResolvedValue("en");
      setLocaleCookie("fr");
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("en");
    });

    it("falls back to the platform default for a full BCP 47 tag", async () => {
      mockGetPlatformDisplayLocale.mockResolvedValue("en");
      setLocaleCookie("ja-JP");
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("en");
    });
  });

  describe("loadPlatformMessages", () => {
    it("loads the catalog of the requested locale", async () => {
      const { loadPlatformMessages } = await importLocale();

      const [ja, en] = await Promise.all([
        loadPlatformMessages("ja"),
        loadPlatformMessages("en"),
      ]);

      expect(ja.locale.label).toBe("表示言語");
      expect(en.locale.label).toBe("Display language");
    });
  });

  describe("platformLocaleCookieOptions", () => {
    it("is a long-lived, root-scoped, lax cookie the inline script can read", async () => {
      const { platformLocaleCookieOptions } = await importLocale();

      expect(platformLocaleCookieOptions).toMatchObject({
        // The `<html lang>` script reads it from `document.cookie`.
        httpOnly: false,
        maxAge: 31_536_000,
        path: "/",
        sameSite: "lax",
      });
    });
  });
});
