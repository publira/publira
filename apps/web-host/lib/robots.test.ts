import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildRobotsTxt, respondWithRobotsTxt } from "./robots";

const { mockGetTenantPublicOrigin } = vi.hoisted(() => ({
  mockGetTenantPublicOrigin: vi.fn(),
}));

vi.mock("./tenant", () => ({
  getTenantPublicOrigin: mockGetTenantPublicOrigin,
}));

const TENANT_ID = "019d008d-184d-7d31-a78a-89728a746e38";

const lines = (text: string): string[] => text.split("\n");

describe("buildRobotsTxt", () => {
  it("opens the catalogue and names the sitemap at the tenant's origin", () => {
    const text = buildRobotsTxt("https://shop.example.com");

    expect(lines(text).slice(0, 3)).toStrictEqual([
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
    ]);
    expect(lines(text)).toContain(
      "Sitemap: https://shop.example.com/sitemap.xml"
    );
  });

  it("disallows each reader-only path bare and under a locale prefix", () => {
    const text = lines(buildRobotsTxt("https://shop.example.com"));

    for (const path of ["/my", "/settings", "/login", "/verify"]) {
      expect(text).toContain(`Disallow: ${path}$`);
      expect(text).toContain(`Disallow: ${path}/`);
      expect(text).toContain(`Disallow: ${path}?`);
      expect(text).toContain(`Disallow: /ja${path}$`);
    }
  });

  it("does not shut out a published page whose slug starts like a reader-only path", () => {
    const text = lines(buildRobotsTxt("https://shop.example.com"));

    expect(text).not.toContain("Disallow: /my");
    expect(text).not.toContain("Disallow: /announcements$");
  });
});

describe("respondWithRobotsTxt", () => {
  beforeEach(() => {
    mockGetTenantPublicOrigin.mockReset();
  });

  it("answers the tenant's robots.txt as plain text", async () => {
    mockGetTenantPublicOrigin.mockResolvedValueOnce("https://shop.example.com");

    const response = await respondWithRobotsTxt({ tenant_id: TENANT_ID });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8"
    );
    await expect(response.text()).resolves.toContain(
      "Sitemap: https://shop.example.com/sitemap.xml"
    );
    expect(mockGetTenantPublicOrigin).toHaveBeenCalledWith(TENANT_ID);
  });

  it("answers 503 while the tenant's address is unavailable", async () => {
    mockGetTenantPublicOrigin.mockResolvedValueOnce(null);

    const response = await respondWithRobotsTxt({ tenant_id: TENANT_ID });

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("answers 404 for a segment proxy.ts would never rewrite onto", async () => {
    const response = await respondWithRobotsTxt({ tenant_id: "favicon.ico" });

    expect(response.status).toBe(404);
    expect(mockGetTenantPublicOrigin).not.toHaveBeenCalled();
  });
});
