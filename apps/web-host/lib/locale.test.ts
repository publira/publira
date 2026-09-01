import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockNotFound, mockRootLocale, mockTenantId, mockTenantLocalePath } =
  vi.hoisted(() => ({
    mockNotFound: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
    mockRootLocale: vi.fn(),
    mockTenantId: vi.fn(),
    mockTenantLocalePath: vi.fn(),
  }));

vi.mock("next/navigation", () => ({ notFound: mockNotFound }));
vi.mock("next/root-params", () => ({ locale: mockRootLocale }));
vi.mock("./tenant-id", () => ({ getTenantId: mockTenantId }));
vi.mock("./tenant-locale-path", () => ({
  tenantLocalePath: mockTenantLocalePath,
}));

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("getLocale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the locale the URL names", async () => {
    mockRootLocale.mockResolvedValue("en");
    const { getLocale } = await import("./locale");

    await expect(getLocale()).resolves.toBe("en");
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  // A prefix this build serves no catalog for is a 404, not a page in some
  // other language under a URL that promises this one.
  it("answers 404 for a locale segment this site does not serve", async () => {
    mockRootLocale.mockResolvedValue("fr");
    const { getLocale } = await import("./locale");

    await expect(getLocale()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("answers 404 when the segment carries no value at all", async () => {
    mockRootLocale.mockImplementation(() => Promise.resolve());
    const { getLocale } = await import("./locale");

    await expect(getLocale()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("localePath", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The prefix is decided against the tenant's saved default, so the href this
  // returns can never be built without that stored value.
  it("prefixes the href through the tenant's stored default locale", async () => {
    mockRootLocale.mockResolvedValue("en");
    mockTenantId.mockResolvedValue(TENANT_ID);
    mockTenantLocalePath.mockResolvedValue("/en/series");
    const { localePath } = await import("./locale");

    await expect(localePath("/series")).resolves.toBe("/en/series");
    expect(mockTenantLocalePath).toHaveBeenCalledWith(
      TENANT_ID,
      "en",
      "/series"
    );
  });

  it("propagates an unreadable tenant instead of naming a locale", async () => {
    mockRootLocale.mockResolvedValue("en");
    mockTenantId.mockResolvedValue(TENANT_ID);
    mockTenantLocalePath.mockRejectedValue(
      new Error(`tenant default locale is unavailable: ${TENANT_ID}`)
    );
    const { localePath } = await import("./locale");

    await expect(localePath("/series")).rejects.toThrow(
      "tenant default locale is unavailable"
    );
  });
});
