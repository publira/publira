import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCookies,
  mockGetTenantDisplayLocale,
  mockNotFound,
  mockRootLocale,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetTenantDisplayLocale: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  }),
  mockRootLocale: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("next/navigation", () => ({ notFound: mockNotFound }));

vi.mock("next/root-params", () => ({ locale: mockRootLocale }));

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

  describe("getAdminLocale", () => {
    it("returns the locale stored in the cookie", async () => {
      setLocaleCookie("en");
      const { getAdminLocale } = await importLocale();

      await expect(getAdminLocale(TENANT_ID)).resolves.toBe("en");
      expect(mockGetTenantDisplayLocale).not.toHaveBeenCalled();
    });

    it("keeps an explicit ja cookie even when the tenant default is en", async () => {
      setLocaleCookie("ja");
      const { getAdminLocale } = await importLocale();

      await expect(getAdminLocale(TENANT_ID)).resolves.toBe("ja");
      expect(mockGetTenantDisplayLocale).not.toHaveBeenCalled();
    });

    it("uses the tenant default locale when the cookie is not set", async () => {
      const { getAdminLocale } = await importLocale();

      await expect(getAdminLocale(TENANT_ID)).resolves.toBe("en");
      expect(mockGetTenantDisplayLocale).toHaveBeenCalledWith(TENANT_ID);
    });

    it("refuses a segment that is not a tenant id", async () => {
      const { getAdminLocale } = await importLocale();

      await expect(getAdminLocale("not-a-tenant")).rejects.toThrow(
        "not a tenant id"
      );
      await expect(getAdminLocale("favicon.ico")).rejects.toThrow(
        "not a tenant id"
      );
      expect(mockGetTenantDisplayLocale).not.toHaveBeenCalled();
    });

    it("reports an unreadable tenant default instead of naming a locale", async () => {
      mockGetTenantDisplayLocale.mockRejectedValueOnce(
        new Error("tenant default locale is unavailable: TENANT001")
      );
      const { getAdminLocale } = await importLocale();

      await expect(getAdminLocale(TENANT_ID)).rejects.toThrow(
        "tenant default locale is unavailable"
      );
    });

    it("falls through to the tenant default for an unsupported cookie value", async () => {
      setLocaleCookie("fr");
      const { getAdminLocale } = await importLocale();

      await expect(getAdminLocale(TENANT_ID)).resolves.toBe("en");
      expect(mockGetTenantDisplayLocale).toHaveBeenCalledWith(TENANT_ID);
    });

    it("falls through to the tenant default for a full BCP 47 tag", async () => {
      setLocaleCookie("ja-JP");
      const { getAdminLocale } = await importLocale();

      await expect(getAdminLocale(TENANT_ID)).resolves.toBe("en");
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

  describe("getLocale", () => {
    it("answers the locale the proxy rewrote the request onto", async () => {
      mockRootLocale.mockResolvedValue("en");
      const { getLocale } = await importLocale();

      await expect(getLocale()).resolves.toBe("en");
    });

    // The cookie and the tenant's default are the proxy's to weigh; by the time
    // a page renders, the route has already named the answer.
    it("reads neither the cookie nor the tenant's default", async () => {
      mockRootLocale.mockResolvedValue("en");
      setLocaleCookie("ja");
      const { getLocale } = await importLocale();

      await expect(getLocale()).resolves.toBe("en");
      expect(mockCookies).not.toHaveBeenCalled();
      expect(mockGetTenantDisplayLocale).not.toHaveBeenCalled();
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
});
