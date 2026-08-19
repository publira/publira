import { STATIC_PARAM_PLACEHOLDER } from "@publira/utils/static-param-placeholder";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetTenantName, mockNotFound, mockTenantId } = vi.hoisted(() => ({
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

vi.mock("#lib/public-api", () => ({
  getTenantName: mockGetTenantName,
}));

const tenantId = "018f0e6a-1000-7000-8000-000000000001";

describe("generateMetadata", () => {
  beforeEach(() => {
    mockGetTenantName.mockReset();
    mockNotFound.mockClear();
    mockTenantId.mockReset();
  });

  it("公開 API のテナント名でタイトルを組み立てる", async () => {
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

  it("文字列でない tenant_id では公開 API を呼ばずフォールバックする", async () => {
    mockTenantId.mockResolvedValueOnce(null);

    const { generateMetadata } = await import("./layout");

    await expect(generateMetadata()).resolves.toEqual({ title: "管理画面" });
    expect(mockGetTenantName).not.toHaveBeenCalled();
  });

  it("UUID でない tenant_id では公開 API を呼ばずフォールバックする", async () => {
    mockTenantId.mockResolvedValueOnce("favicon.ico");

    const { generateMetadata } = await import("./layout");

    await expect(generateMetadata()).resolves.toEqual({ title: "管理画面" });
    expect(mockGetTenantName).not.toHaveBeenCalled();
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it("generateStaticParams のプレースホルダでは notFound する", async () => {
    mockTenantId.mockResolvedValueOnce(STATIC_PARAM_PLACEHOLDER);

    const { generateMetadata } = await import("./layout");

    await expect(generateMetadata()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockNotFound).toHaveBeenCalledOnce();
    expect(mockGetTenantName).not.toHaveBeenCalled();
  });
});
