import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetTenantTheme } = vi.hoisted(() => ({
  mockGetTenantTheme: vi.fn(),
}));

vi.mock("#lib/tenant", () => ({
  getTenantTheme: mockGetTenantTheme,
}));

const { GET } = await import("./route");

describe("GET /theme.css", () => {
  beforeEach(() => {
    mockGetTenantTheme.mockReset();
  });

  it("専用テーマ読取の色と短期キャッシュヘッダーを返す", async () => {
    mockGetTenantTheme.mockResolvedValueOnce({ primaryColor: "#112233" });

    const response = await GET(
      new NextRequest("https://shop.example.test/theme.css"),
      {
        params: Promise.resolve({
          tenant_id: "11111111-1111-4111-8111-111111111111",
        }),
      }
    );

    await expect(response.text()).resolves.toContain(
      "--publira-color-primary:#112233;"
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=30, s-maxage=30, stale-while-revalidate=60"
    );
    expect(response.headers.get("Content-Type")).toBe(
      "text/css; charset=utf-8"
    );
    expect(mockGetTenantTheme).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111"
    );
  });

  it("proxy を通らない不正なテナント ID では既定テーマを返す", async () => {
    const response = await GET(
      new NextRequest("https://shop.example.test/theme.css"),
      { params: Promise.resolve({ tenant_id: "not-a-tenant" }) }
    );

    await expect(response.text()).resolves.toContain(
      "--publira-color-primary:#0f7c82;"
    );
    expect(mockGetTenantTheme).not.toHaveBeenCalled();
  });
});
