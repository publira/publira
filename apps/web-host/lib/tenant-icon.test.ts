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

describe("resolveTenantIcons", () => {
  it("favicon が設定されていれば配信 URL を指す", () => {
    const icons = resolveTenantIcons(
      siteInfo({ faviconUrl: "/images/tenants/favicon-1" })
    );

    expect(icons).toEqual({
      apple: [{ url: "/images/tenants/favicon-1" }],
      icon: [{ url: "/images/tenants/favicon-1" }],
    });
  });

  it("favicon が未設定ならアイコンを宣言しない", () => {
    expect(resolveTenantIcons(siteInfo({}))).toBeUndefined();
    expect(resolveTenantIcons(null)).toBeUndefined();
  });

  it("空白だけの値は未設定として扱う", () => {
    expect(resolveTenantIcons(siteInfo({ faviconUrl: "  " }))).toBeUndefined();
  });
});
