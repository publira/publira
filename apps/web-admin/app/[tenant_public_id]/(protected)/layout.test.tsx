import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCookies,
  mockGetAdminCurrentUser,
  mockGetTenantForSession,
  mockNotFound,
  mockRedirect,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGetAdminCurrentUser: vi.fn(),
  mockGetTenantForSession: vi.fn(),
  mockNotFound: vi.fn(),
  mockRedirect: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mockCookies,
}));

vi.mock("next/navigation", () => ({
  notFound: mockNotFound,
  redirect: mockRedirect,
}));

vi.mock("@publira/utils/next-static-params", () => ({
  createPlaceholderStaticParams: vi.fn(() => [
    { tenant_public_id: "__placeholder__" },
  ]),
  guardPlaceholder: vi.fn(),
}));

vi.mock("../../../components/admin-layout", () => ({
  AdminLayout: ({
    children,
    currentUser,
    tenant,
  }: {
    children: ReactNode;
    currentUser: { name: string };
    tenant: { adminDomain: string; name: string };
  }) => (
    <div>
      <p>{currentUser.name}</p>
      <p>{tenant.name}</p>
      <p>{tenant.adminDomain}</p>
      {children}
    </div>
  ),
}));

vi.mock("../../../lib/admin-auth", () => ({
  getAdminCurrentUser: mockGetAdminCurrentUser,
}));

vi.mock("../../../lib/tenant-detail", () => ({
  getTenantForSession: mockGetTenantForSession,
}));

describe("protected layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    mockCookies.mockResolvedValue({
      get: () => ({ value: "session_001" }),
    });
    mockRedirect.mockImplementation((path: string) => {
      throw new Error(`redirect:${path}`);
    });
    mockNotFound.mockImplementation(() => {
      throw new Error("notFound");
    });
  });

  it("テナント名を含む metadata title を生成する", async () => {
    mockGetTenantForSession.mockResolvedValueOnce({
      adminDomain: "admin.example.com",
      domain: "example.com",
      name: "青枝出版",
      publicId: "tenant_001",
    });

    const { generateMetadata } = await import("./layout");
    const metadata = await generateMetadata({
      params: Promise.resolve({ tenant_public_id: "tenant_001" }),
    });

    expect(metadata.title).toEqual({
      default: "管理画面 | 青枝出版",
      template: "%s | 管理画面 | 青枝出版",
    });
    expect(mockGetTenantForSession).toHaveBeenCalledWith("tenant_001");
  });

  it("共通レイアウトへ tenant 情報を渡して描画する", async () => {
    mockGetAdminCurrentUser.mockResolvedValueOnce({
      name: "管理者",
      publicId: "user_001",
      role: "admin",
    });
    mockGetTenantForSession.mockResolvedValueOnce({
      adminDomain: "admin.example.com",
      domain: "example.com",
      name: "青枝出版",
      publicId: "tenant_001",
    });

    const { ProtectedLayoutContent } = await import("./layout");
    const element = await ProtectedLayoutContent({
      children: <p>child</p>,
      params: Promise.resolve({ tenant_public_id: "tenant_001" }),
    });

    const html = renderToStaticMarkup(element);
    expect(html).toContain("管理者");
    expect(html).toContain("青枝出版");
    expect(html).toContain("admin.example.com");
    expect(html).toContain("child");
  });

  it("tenant 取得失敗時は notFound へフォールバックする", async () => {
    mockGetAdminCurrentUser.mockResolvedValueOnce({
      name: "管理者",
      publicId: "user_001",
      role: "admin",
    });
    mockGetTenantForSession.mockResolvedValueOnce(null);

    const { ProtectedLayoutContent } = await import("./layout");

    await expect(
      ProtectedLayoutContent({
        children: <p>child</p>,
        params: Promise.resolve({ tenant_public_id: "tenant_001" }),
      })
    ).rejects.toThrowError("notFound");
  });
});
