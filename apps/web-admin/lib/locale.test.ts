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

describe("web-admin locale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    setLocaleCookie();
  });

  describe("getLocale", () => {
    it("falls back to ja when the cookie is not set", async () => {
      const { getLocale } = await importLocale();

      await expect(getLocale()).resolves.toBe("ja");
    });

    it("returns the locale stored in the cookie", async () => {
      setLocaleCookie("en");
      const { getLocale } = await importLocale();

      await expect(getLocale()).resolves.toBe("en");
    });

    it("falls back to ja for an unsupported cookie value", async () => {
      setLocaleCookie("fr");
      const { getLocale } = await importLocale();

      await expect(getLocale()).resolves.toBe("ja");
    });

    it("falls back to ja for a full BCP 47 tag", async () => {
      setLocaleCookie("ja-JP");
      const { getLocale } = await importLocale();

      await expect(getLocale()).resolves.toBe("ja");
    });
  });

  describe("loadAdminMessages", () => {
    it("loads the catalog of the requested locale", async () => {
      const { loadAdminMessages } = await importLocale();

      const [ja, en] = await Promise.all([
        loadAdminMessages("ja"),
        loadAdminMessages("en"),
      ]);

      expect(ja.locale.label).toBe("表示言語");
      expect(en.locale.label).toBe("Display language");
    });
  });

  describe("adminLocaleCookieOptions", () => {
    it("is a long-lived, root-scoped, lax cookie the inline script can read", async () => {
      const { adminLocaleCookieOptions } = await importLocale();

      expect(adminLocaleCookieOptions).toMatchObject({
        // The `<html lang>` script reads it from `document.cookie`.
        httpOnly: false,
        maxAge: 31_536_000,
        path: "/",
        sameSite: "lax",
      });
    });
  });
});
