import { describe, expect, it } from "vitest";

import type { TenantImageVariant } from "./tenant";
import { resolveTenantBrandMarkVariant } from "./tenant-brand-mark";

const markVariant = (
  overrides: Partial<TenantImageVariant> = {}
): TenantImageVariant => ({
  contentType: "image/png",
  fileSizeBytes: 1024,
  height: 40,
  label: "original",
  url: "/images/tenants/media-1/app_store_badge",
  variantType: "app_store_badge",
  width: 120,
  ...overrides,
});

describe("resolveTenantBrandMarkVariant", () => {
  it("returns the variant of the kind asked for", () => {
    const variant = markVariant();

    expect(
      resolveTenantBrandMarkVariant(
        { brandMarks: { app_store_badge: [variant] } },
        "app_store_badge"
      )
    ).toEqual(variant);
  });

  it("returns null for a kind the tenant uploaded nothing for", () => {
    expect(
      resolveTenantBrandMarkVariant(
        { brandMarks: { app_store_badge: [markVariant()] } },
        "google_play_badge"
      )
    ).toBeNull();
    expect(resolveTenantBrandMarkVariant({}, "x_share")).toBeNull();
    expect(resolveTenantBrandMarkVariant(null, "x_share")).toBeNull();
  });

  it("treats a blank URL as unset", () => {
    expect(
      resolveTenantBrandMarkVariant(
        { brandMarks: { x_share: [markVariant({ url: "  " })] } },
        "x_share"
      )
    ).toBeNull();
  });

  it("treats a master with no width or height as unset", () => {
    expect(
      resolveTenantBrandMarkVariant(
        { brandMarks: { line_share: [markVariant({ width: 0 })] } },
        "line_share"
      )
    ).toBeNull();
    expect(
      resolveTenantBrandMarkVariant(
        { brandMarks: { line_share: [markVariant({ height: 0 })] } },
        "line_share"
      )
    ).toBeNull();
  });
});
