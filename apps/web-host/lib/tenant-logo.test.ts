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
  it("ロゴが設定されていれば先頭のバリアントを返す", () => {
    const variant = logoVariant();

    expect(
      resolveTenantLogoVariant(siteInfo({ logoImageVariants: [variant] }))
    ).toEqual(variant);
  });

  it("ロゴが未設定なら null", () => {
    expect(resolveTenantLogoVariant(siteInfo({}))).toBeNull();
    expect(resolveTenantLogoVariant(null)).toBeNull();
  });

  it("空白だけの URL は未設定として扱う", () => {
    expect(
      resolveTenantLogoVariant(
        siteInfo({ logoImageVariants: [logoVariant({ url: "  " })] })
      )
    ).toBeNull();
  });

  it("幅または高さが 0 のバリアントは未設定として扱う", () => {
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
