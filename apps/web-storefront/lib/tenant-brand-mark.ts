import type {
  TenantBrandMarkKind,
  TenantImageVariant,
  TenantSiteInfo,
} from "./tenant";

/**
 * The variant the site draws for the tenant's `kind` of third-party mark, or
 * `null` where it draws that control's text alone. Like the logo, a mark is
 * one stored master the image server resizes on request, so it has one
 * variant.
 *
 * Empty URLs and 0×0 masters are treated as unset: `next/image` cannot lay
 * them out, and an image slot with nothing in it is worse than the text.
 */
export const resolveTenantBrandMarkVariant = (
  info: Pick<TenantSiteInfo, "brandMarks"> | null,
  kind: TenantBrandMarkKind
): TenantImageVariant | null => {
  const variant = info?.brandMarks?.[kind]?.[0];
  if (!(variant?.url.trim() && variant.width > 0 && variant.height > 0)) {
    return null;
  }
  return variant;
};
