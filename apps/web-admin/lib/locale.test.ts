import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCookies, mockGetAccessToken, mockGetTenantDisplayLocale } =
  vi.hoisted(() => ({
    mockCookies: vi.fn(),
    mockGetAccessToken: vi.fn(),
    mockGetTenantDisplayLocale: vi.fn(),
  }));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("./session", () => ({
  getAccessToken: mockGetAccessToken,
}));

vi.mock("./tenant-default-locale", () => ({
  getTenantDisplayLocale: mockGetTenantDisplayLocale,
}));

const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

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
    mockGetAccessToken.mockResolvedValue("");
    mockGetTenantDisplayLocale.mockResolvedValue("en");
  });

  describe("getLocale", () => {
    it("falls back to ja when the cookie is not set and there is no session", async () => {
      mockGetAccessToken.mockResolvedValue("");
      const { getLocale } = await importLocale();

      await expect(getLocale(TENANT_ID)).resolves.toBe("ja");
      expect(mockGetTenantDisplayLocale).not.toHaveBeenCalled();
    });

    it("falls back to ja when no tenant id is passed", async () => {
      mockGetAccessToken.mockResolvedValue("session-token");
      const { getLocale } = await importLocale();

      await expect(getLocale()).resolves.toBe("ja");
      expect(mockGetTenantDisplayLocale).not.toHaveBeenCalled();
    });

    it("returns the locale stored in the cookie", async () => {
      setLocaleCookie("en");
      const { getLocale } = await importLocale();

      await expect(getLocale(TENANT_ID)).resolves.toBe("en");
      expect(mockGetTenantDisplayLocale).not.toHaveBeenCalled();
    });

    it("keeps an explicit ja cookie even when the tenant default is en", async () => {
      setLocaleCookie("ja");
      mockGetAccessToken.mockResolvedValue("session-token");
      const { getLocale } = await importLocale();

      await expect(getLocale(TENANT_ID)).resolves.toBe("ja");
      expect(mockGetTenantDisplayLocale).not.toHaveBeenCalled();
    });

    it("uses the tenant default locale when the cookie is not set", async () => {
      mockGetAccessToken.mockResolvedValue("session-token");
      const { getLocale } = await importLocale();

      await expect(getLocale(TENANT_ID)).resolves.toBe("en");
      expect(mockGetTenantDisplayLocale).toHaveBeenCalledWith(TENANT_ID);
    });

    it("falls back to ja when the tenant id is not a UUID", async () => {
      mockGetAccessToken.mockResolvedValue("session-token");
      const { getLocale } = await importLocale();

      await expect(getLocale("not-a-tenant")).resolves.toBe("ja");
      expect(mockGetTenantDisplayLocale).not.toHaveBeenCalled();
    });

    it("falls through to the tenant default for an unsupported cookie value", async () => {
      setLocaleCookie("fr");
      mockGetAccessToken.mockResolvedValue("session-token");
      const { getLocale } = await importLocale();

      await expect(getLocale(TENANT_ID)).resolves.toBe("en");
      expect(mockGetTenantDisplayLocale).toHaveBeenCalledWith(TENANT_ID);
    });

    it("falls through to the tenant default for a full BCP 47 tag", async () => {
      setLocaleCookie("ja-JP");
      mockGetAccessToken.mockResolvedValue("session-token");
      const { getLocale } = await importLocale();

      await expect(getLocale(TENANT_ID)).resolves.toBe("en");
    });

    it("falls back to ja for an unsupported cookie when there is no session", async () => {
      setLocaleCookie("fr");
      const { getLocale } = await importLocale();

      await expect(getLocale(TENANT_ID)).resolves.toBe("ja");
      expect(mockGetTenantDisplayLocale).not.toHaveBeenCalled();
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
