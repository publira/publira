import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCookies, mockGetTenantDisplayLocale } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetTenantDisplayLocale: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("./public-api", () => ({
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
    mockGetTenantDisplayLocale.mockResolvedValue("en");
  });

  describe("getLocale", () => {
    it("returns the locale stored in the cookie", async () => {
      setLocaleCookie("en");
      const { getLocale } = await importLocale();

      await expect(getLocale(TENANT_ID)).resolves.toBe("en");
      expect(mockGetTenantDisplayLocale).not.toHaveBeenCalled();
    });

    it("keeps an explicit ja cookie even when the tenant default is en", async () => {
      setLocaleCookie("ja");
      const { getLocale } = await importLocale();

      await expect(getLocale(TENANT_ID)).resolves.toBe("ja");
      expect(mockGetTenantDisplayLocale).not.toHaveBeenCalled();
    });

    it("uses the tenant default locale when the cookie is not set", async () => {
      const { getLocale } = await importLocale();

      await expect(getLocale(TENANT_ID)).resolves.toBe("en");
      expect(mockGetTenantDisplayLocale).toHaveBeenCalledWith(TENANT_ID);
    });

    it("refuses a segment that is not a tenant id", async () => {
      const { getLocale } = await importLocale();

      await expect(getLocale("not-a-tenant")).rejects.toThrow(
        "not a tenant id"
      );
      await expect(getLocale("favicon.ico")).rejects.toThrow("not a tenant id");
      expect(mockGetTenantDisplayLocale).not.toHaveBeenCalled();
    });

    it("reports an unreadable tenant default instead of naming a locale", async () => {
      mockGetTenantDisplayLocale.mockRejectedValueOnce(
        new Error("tenant default locale is unavailable: TENANT001")
      );
      const { getLocale } = await importLocale();

      await expect(getLocale(TENANT_ID)).rejects.toThrow(
        "tenant default locale is unavailable"
      );
    });

    it("falls through to the tenant default for an unsupported cookie value", async () => {
      setLocaleCookie("fr");
      const { getLocale } = await importLocale();

      await expect(getLocale(TENANT_ID)).resolves.toBe("en");
      expect(mockGetTenantDisplayLocale).toHaveBeenCalledWith(TENANT_ID);
    });

    it("falls through to the tenant default for a full BCP 47 tag", async () => {
      setLocaleCookie("ja-JP");
      const { getLocale } = await importLocale();

      await expect(getLocale(TENANT_ID)).resolves.toBe("en");
    });
  });

  describe("loadAdminMessages", () => {
    it("loads the catalog of the requested locale, so ja and en differ", async () => {
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
