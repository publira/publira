import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetTenantLinkDefaultLocale,
  mockNotFound,
  mockRootLocale,
  mockTenantId,
} = vi.hoisted(() => ({
  mockGetTenantLinkDefaultLocale: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  mockRootLocale: vi.fn(),
  mockTenantId: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mockNotFound }));
vi.mock("next/root-params", () => ({ locale: mockRootLocale }));
vi.mock("./tenant-id", () => ({ getTenantId: mockTenantId }));
vi.mock("./tenant", () => ({
  getTenantLinkDefaultLocale: mockGetTenantLinkDefaultLocale,
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

  it("prefixes the href with a locale other than the tenant's stored default", async () => {
    mockRootLocale.mockResolvedValue("en");
    mockTenantId.mockResolvedValue(TENANT_ID);
    mockGetTenantLinkDefaultLocale.mockResolvedValue("ja");
    const { localePath } = await import("./locale");

    await expect(localePath("/series")).resolves.toBe("/en/series");
    expect(mockGetTenantLinkDefaultLocale).toHaveBeenCalledWith(TENANT_ID);
  });

  it("leaves the href bare in the tenant's stored default", async () => {
    mockRootLocale.mockResolvedValue("en");
    mockTenantId.mockResolvedValue(TENANT_ID);
    mockGetTenantLinkDefaultLocale.mockResolvedValue("en");
    const { localePath } = await import("./locale");

    await expect(localePath("/series")).resolves.toBe("/series");
  });

  // The site header's search form takes its action from here, so a throw would
  // take the whole site chrome down while the tenant read is unavailable.
  it("keeps the prefix while the tenant's stored default is unavailable", async () => {
    mockRootLocale.mockResolvedValue("en");
    mockTenantId.mockResolvedValue(TENANT_ID);
    mockGetTenantLinkDefaultLocale.mockResolvedValue(null);
    const { localePath } = await import("./locale");

    await expect(localePath("/series")).resolves.toBe("/en/series");
  });
});
