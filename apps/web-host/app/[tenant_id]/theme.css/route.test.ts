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

  it("Return dedicated theme read colors and short-term cache headers", async () => {
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

  it("Returns default theme for invalid tenant ID that does not pass through proxy", async () => {
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
