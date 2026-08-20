import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
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
  });

  describe("getPlatformLocale", () => {
    it("falls back to ja when the cookie is not set", async () => {
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("ja");
    });

    it("returns the locale stored in the cookie", async () => {
      setLocaleCookie("en");
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("en");
    });

    it("falls back to ja for an unsupported cookie value", async () => {
      setLocaleCookie("fr");
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("ja");
    });

    it("falls back to ja for a full BCP 47 tag", async () => {
      setLocaleCookie("ja-JP");
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("ja");
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
