import { beforeEach, describe, expect, it, vi } from "vitest";

const getTenantDefaultLocale = vi.fn();
const getTenantPublicOrigin = vi.fn();

vi.mock("./tenant", () => ({
  getTenantDefaultLocale,
  getTenantPublicOrigin,
}));

const { tenantLocaleAlternates, tenantLocalePath, tenantLocaleUrl } =
  await import("./tenant-locale-path");

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(() => {
  getTenantDefaultLocale.mockResolvedValue("ja");
  getTenantPublicOrigin.mockResolvedValue("https://example.test");
});

describe("tenantLocalePath", () => {
  it("leaves the tenant default locale unprefixed", async () => {
    await expect(
      tenantLocalePath(TENANT_ID, "ja", "/series/SR01")
    ).resolves.toBe("/series/SR01");
  });

  it("prefixes any other locale", async () => {
    await expect(
      tenantLocalePath(TENANT_ID, "en", "/series/SR01")
    ).resolves.toBe("/en/series/SR01");
  });
});

describe("tenantLocaleUrl", () => {
  it("writes the canonical path against the tenant's own origin", async () => {
    await expect(
      tenantLocaleUrl(TENANT_ID, "en", "/series/SR01")
    ).resolves.toBe("https://example.test/en/series/SR01");
  });

  it("omits the prefix for the tenant default locale", async () => {
    await expect(
      tenantLocaleUrl(TENANT_ID, "ja", "/series/SR01")
    ).resolves.toBe("https://example.test/series/SR01");
  });

  it("answers with nothing when the tenant has no reachable origin", async () => {
    getTenantPublicOrigin.mockResolvedValue(null);

    await expect(
      tenantLocaleUrl(TENANT_ID, "ja", "/series/SR01")
    ).resolves.toBeNull();
    expect(getTenantDefaultLocale).not.toHaveBeenCalled();
  });
});

describe("tenantLocaleAlternates", () => {
  it("builds the alternates against the tenant's default locale", async () => {
    getTenantDefaultLocale.mockResolvedValue("en");

    const alternates = await tenantLocaleAlternates(
      TENANT_ID,
      "ja",
      "/ranking"
    );

    expect(alternates?.canonical).toBe("/ja/ranking");
    expect(alternates?.languages["x-default"]).toBe("/ranking");
  });

  it("answers with nothing when there is no origin to resolve them against", async () => {
    getTenantPublicOrigin.mockResolvedValue(null);

    await expect(
      tenantLocaleAlternates(TENANT_ID, "ja", "/ranking")
    ).resolves.toBeUndefined();
    expect(getTenantDefaultLocale).not.toHaveBeenCalled();
  });
});
