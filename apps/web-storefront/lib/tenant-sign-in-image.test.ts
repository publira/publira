import { describe, expect, it } from "vitest";

import type { TenantImageVariant, TenantSiteInfo } from "./tenant";
import { resolveTenantSignInImageVariant } from "./tenant-sign-in-image";

const siteInfo = (overrides: Partial<TenantSiteInfo>): TenantSiteInfo => ({
  acceptsPayments: false,
  ageVerification: "none",
  appPayments: { appStore: false, googlePlay: false },
  commentMode: "disabled",
  currency: "JPY",
  defaultLocale: "ja",
  domain: "example.test",
  name: "Example Tenant",
  publicId: "TENANT_PUBLIC",
  signUpOpen: true,
  supportedLocales: ["ja"],
  timeZone: "UTC",
  ...overrides,
});

const signInVariant = (
  overrides: Partial<TenantImageVariant> = {}
): TenantImageVariant => ({
  contentType: "image/jpeg",
  fileSizeBytes: 204_800,
  height: 1600,
  label: "original",
  url: "/images/tenants/sign-in-1/sign_in",
  variantType: "sign_in",
  width: 1200,
  ...overrides,
});

describe("resolveTenantSignInImageVariant", () => {
  it("returns the first variant while the tenant has an image", () => {
    const variant = signInVariant();

    expect(
      resolveTenantSignInImageVariant(
        siteInfo({ signInImageVariants: [variant] })
      )
    ).toEqual(variant);
  });

  it("returns null while the tenant has uploaded none", () => {
    expect(resolveTenantSignInImageVariant(siteInfo({}))).toBeNull();
    expect(resolveTenantSignInImageVariant(null)).toBeNull();
  });

  it("treats a blank URL as no image", () => {
    expect(
      resolveTenantSignInImageVariant(
        siteInfo({ signInImageVariants: [signInVariant({ url: "  " })] })
      )
    ).toBeNull();
  });

  it("treats a variant with no width or height as no image", () => {
    expect(
      resolveTenantSignInImageVariant(
        siteInfo({ signInImageVariants: [signInVariant({ width: 0 })] })
      )
    ).toBeNull();
    expect(
      resolveTenantSignInImageVariant(
        siteInfo({ signInImageVariants: [signInVariant({ height: 0 })] })
      )
    ).toBeNull();
  });
});
