import { STATIC_PARAM_PLACEHOLDER } from "@publira/utils/static-param-placeholder";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetLocale, mockGetTenantName, mockNotFound, mockTenantId } =
  vi.hoisted(() => ({
    mockGetLocale: vi.fn(() => Promise.resolve("ja")),
    mockGetTenantName: vi.fn(),
    mockNotFound: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
    mockTenantId: vi.fn(),
  }));

vi.mock("../globals.css", () => ({}));

vi.mock("next/root-params", () => ({
  tenant_id: mockTenantId,
}));

vi.mock("next/navigation", () => ({
  notFound: mockNotFound,
}));

vi.mock("#lib/locale", async () => {
  const { sharedCatalog } = await import("@publira/i18n/catalog");

  return {
    getLocale: mockGetLocale,
    loadAdminMessages: () => Promise.resolve(sharedCatalog("ja")),
  };
});

vi.mock("#lib/public-api", () => ({
  getTenantName: mockGetTenantName,
}));

const tenantId = "018f0e6a-1000-7000-8000-000000000001";

describe("generateMetadata", () => {
  beforeEach(() => {
    mockGetLocale.mockClear();
    mockGetTenantName.mockReset();
    mockNotFound.mockClear();
    mockTenantId.mockReset();
  });

  it("builds the title from the tenant name the public API returns", async () => {
    mockTenantId.mockResolvedValueOnce(tenantId);
    mockGetTenantName.mockResolvedValueOnce("サンプル出版社");

    const { generateMetadata } = await import("./layout");

    await expect(generateMetadata()).resolves.toEqual({
      title: {
        default: "サンプル出版社 管理画面",
        template: "%s | サンプル出版社 管理画面",
      },
    });
    expect(mockGetTenantName).toHaveBeenCalledWith(tenantId);
  });

  it("titles nothing for a segment that is not a tenant id", async () => {
    mockTenantId.mockResolvedValueOnce(null);

    const { generateMetadata } = await import("./layout");

    await expect(generateMetadata()).resolves.toEqual({});
    expect(mockGetTenantName).not.toHaveBeenCalled();
  });

  it("reads neither locale nor public API for a segment that is not a UUID", async () => {
    mockTenantId.mockResolvedValueOnce("favicon.ico");

    const { generateMetadata } = await import("./layout");

    await expect(generateMetadata()).resolves.toEqual({});
    expect(mockGetLocale).not.toHaveBeenCalled();
    expect(mockGetTenantName).not.toHaveBeenCalled();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("resolves the locale and the tenant name from the trimmed tenant_id", async () => {
    mockTenantId.mockResolvedValueOnce(` ${tenantId} `);
    mockGetTenantName.mockResolvedValueOnce("サンプル出版社");

    const { generateMetadata } = await import("./layout");

    await generateMetadata();
    expect(mockGetLocale).toHaveBeenCalledWith(tenantId);
    expect(mockGetTenantName).toHaveBeenCalledWith(tenantId);
  });

  it("calls notFound for the generateStaticParams placeholder", async () => {
    mockTenantId.mockResolvedValueOnce(STATIC_PARAM_PLACEHOLDER);

    const { generateMetadata } = await import("./layout");

    await expect(generateMetadata()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalledOnce();
    expect(mockGetTenantName).not.toHaveBeenCalled();
  });
});
