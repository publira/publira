import { describe, expect, it } from "vitest";

import type { TenantImageVariant, TenantSiteInfo } from "./tenant";
import { resolveTenantLogoVariant } from "./tenant-logo";

const siteInfo = (overrides: Partial<TenantSiteInfo>): TenantSiteInfo => ({
  acceptsPayments: false,
  defaultLocale: "ja",
  domain: "example.test",
  name: "テナント",
  publicId: "TENANT_PUBLIC",
  timeZone: "Asia/Tokyo",
  ...overrides,
});

const logoVariant = (
  overrides: Partial<TenantImageVariant> = {}
): TenantImageVariant => ({
  contentType: "image/png",
  fileSizeBytes: 1024,
  height: 64,
  label: "original",
  url: "/images/tenants/logo-1",
  variantType: "logo",
  width: 128,
  ...overrides,
});

describe("resolveTenantLogoVariant", () => {
  it("Returns the first variant if a logo is set", () => {
    const variant = logoVariant();

    expect(
      resolveTenantLogoVariant(siteInfo({ logoImageVariants: [variant] }))
    ).toEqual(variant);
  });

  it("null if no logo is set", () => {
    expect(resolveTenantLogoVariant(siteInfo({}))).toBeNull();
    expect(resolveTenantLogoVariant(null)).toBeNull();
  });

  it("URLs containing only blank spaces are treated as unconfigured.", () => {
    expect(
      resolveTenantLogoVariant(
        siteInfo({ logoImageVariants: [logoVariant({ url: "  " })] })
      )
    ).toBeNull();
  });

  it("Treat variants with zero width or height as unset", () => {
    expect(
      resolveTenantLogoVariant(
        siteInfo({ logoImageVariants: [logoVariant({ width: 0 })] })
      )
    ).toBeNull();
    expect(
      resolveTenantLogoVariant(
        siteInfo({ logoImageVariants: [logoVariant({ height: 0 })] })
      )
    ).toBeNull();
  });
});
