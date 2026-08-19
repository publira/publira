import { DEFAULT_TENANT_THEME_COLORS } from "@publira/utils/theme-css-variables";
import { describe, expect, it } from "vitest";

import type { TenantSiteInfo } from "./tenant";
import { resolveTenantIcons } from "./tenant-icon";

const siteInfo = (overrides: Partial<TenantSiteInfo>): TenantSiteInfo => ({
  domain: "example.test",
  name: "テナント",
  publicId: "TENANT_PUBLIC",
  siteLabel: "テナント",
  theme: DEFAULT_TENANT_THEME_COLORS,
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
  it("icon が設定されていれば配信 URL を指す", () => {
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

  it("icon が未設定ならアイコンを宣言しない", () => {
    expect(resolveTenantIcons(siteInfo({}))).toBeUndefined();
    expect(resolveTenantIcons(null)).toBeUndefined();
  });

  it("空白だけの値は未設定として扱う", () => {
    expect(
      resolveTenantIcons(siteInfo({ iconImageVariants: [iconVariant("  ")] }))
    ).toBeUndefined();
  });
});
