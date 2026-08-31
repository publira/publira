import { describe, expect, it } from "vitest";

import type { TenantSiteInfo } from "./tenant";
import { resolveTenantIcons } from "./tenant-icon";

const siteInfo = (overrides: Partial<TenantSiteInfo>): TenantSiteInfo => ({
  acceptsPayments: false,
  defaultLocale: "ja",
  domain: "example.test",
  name: "テナント",
  publicId: "TENANT_PUBLIC",
  timeZone: "Asia/Tokyo",
  ...overrides,
});

const iconVariant = (url: string) => ({
  contentType: "image/png",
  fileSizeBytes: 1024,
  height: 64,
  label: "original",
  url,
  variantType: "icon",
  width: 64,
});

describe("resolveTenantIcons", () => {
  it("If icon is set, it points to the delivery URL", () => {
    const icons = resolveTenantIcons(
      siteInfo({
        iconImageVariants: [iconVariant("/images/tenants/icon-1")],
      })
    );

    expect(icons).toEqual({
      apple: [{ url: "/images/tenants/icon-1" }],
      icon: [{ url: "/images/tenants/icon-1" }],
    });
  });

  it("Do not declare an icon if icon is not set", () => {
    expect(resolveTenantIcons(siteInfo({}))).toBeUndefined();
    expect(resolveTenantIcons(null)).toBeUndefined();
  });

  it("Values ​​containing only blank spaces are treated as unset.", () => {
    expect(
      resolveTenantIcons(siteInfo({ iconImageVariants: [iconVariant("  ")] }))
    ).toBeUndefined();
  });
});
