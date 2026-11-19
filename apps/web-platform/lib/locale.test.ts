import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCookies,
  mockHeaders,
  mockNotFound,
  mockReadSetupDefaultLocale,
  mockRootLocale,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockHeaders: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
  mockReadSetupDefaultLocale: vi.fn(),
  mockRootLocale: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
  headers: mockHeaders,
}));

vi.mock("next/navigation", () => ({ notFound: mockNotFound }));

vi.mock("next/root-params", () => ({ locale: mockRootLocale }));

vi.mock("./setup-status", () => ({
  readSetupDefaultLocale: mockReadSetupDefaultLocale,
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
    mockHeaders.mockResolvedValue(new Headers());
    mockReadSetupDefaultLocale.mockResolvedValue("ja");
  });

  describe("getPlatformLocale", () => {
    it("falls back to the platform default locale when the cookie is not set", async () => {
      mockReadSetupDefaultLocale.mockResolvedValue("en");
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("en");
    });

    // `ja` is the saved value like any other, not a fallback the console keeps.
    it("uses a platform default of ja without treating it as a special case", async () => {
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("ja");
    });

    it("keeps a cookie of ja instead of falling through to the platform default", async () => {
      mockReadSetupDefaultLocale.mockResolvedValue("en");
      setLocaleCookie("ja");
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("ja");
      expect(mockReadSetupDefaultLocale).not.toHaveBeenCalled();
    });

    it("returns the locale stored in the cookie", async () => {
      mockReadSetupDefaultLocale.mockResolvedValue("ja");
      setLocaleCookie("en");
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("en");
      expect(mockReadSetupDefaultLocale).not.toHaveBeenCalled();
    });

    it("trims surrounding whitespace in the cookie value", async () => {
      setLocaleCookie("  en  ");
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("en");
    });

    it("falls back to the platform default for an unsupported cookie value", async () => {
      mockReadSetupDefaultLocale.mockResolvedValue("en");
      setLocaleCookie("fr");
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("en");
    });

    it("falls back to the platform default for a full BCP 47 tag", async () => {
      mockReadSetupDefaultLocale.mockResolvedValue("en");
      setLocaleCookie("ja-JP");
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("en");
    });
  });

  describe("getLocale", () => {
    it("answers the locale the proxy rewrote the request onto", async () => {
      mockRootLocale.mockResolvedValue("en");
      const { getLocale } = await importLocale();

      await expect(getLocale()).resolves.toBe("en");
    });

    // The cookie and the saved default are the proxy's to weigh; by the time a
    // page renders, the route has already named the answer.
    it("reads neither the cookie nor the saved default", async () => {
      mockRootLocale.mockResolvedValue("en");
      setLocaleCookie("ja");
      const { getLocale } = await importLocale();

      await expect(getLocale()).resolves.toBe("en");
      expect(mockCookies).not.toHaveBeenCalled();
      expect(mockReadSetupDefaultLocale).not.toHaveBeenCalled();
    });

    it.each(["fr", "ja-JP", ""])(
      "answers 404 for a segment that names no supported locale (%j)",
      async (segment) => {
        mockRootLocale.mockResolvedValue(segment);
        const { getLocale } = await importLocale();

        await expect(getLocale()).rejects.toThrow("404");
        expect(mockNotFound).toHaveBeenCalledOnce();
      }
    );
  });

  describe("the platform default", () => {
    it("reads the saved default through the setup status, which needs no session", async () => {
      // The login screen and the signed-in console alike: the saved language
      // decides, not the browser's.
      mockReadSetupDefaultLocale.mockResolvedValue("en");
      mockHeaders.mockResolvedValue(
        new Headers({ "accept-language": "ja,en;q=0.9" })
      );
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("en");
    });

    it("keeps the saved language through an outage", async () => {
      // The operator is reading an error screen; arriving in another language
      // would make the outage look like a setting they had changed.
      mockHeaders.mockResolvedValue(
        new Headers({ "accept-language": "en-US,en;q=0.9" })
      );
      const { getPlatformLocale } = await importLocale();

      await expect(getPlatformLocale()).resolves.toBe("ja");

      mockReadSetupDefaultLocale.mockResolvedValue(null);

      await expect(getPlatformLocale()).resolves.toBe("ja");
    });

    it("negotiates from Accept-Language only before anything is saved", async () => {
      mockReadSetupDefaultLocale.mockResolvedValue(null);
      mockHeaders.mockResolvedValue(
        new Headers({ "accept-language": "en-US,en;q=0.9" })
      );
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
