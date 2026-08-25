import type { TenantImageVariant, TenantSiteInfo } from "./tenant";

/**
 * The variant the public header should render as the brand mark (#542).
 * `variantType` names what the image is for, not a size — the image server
 * resizes the stored master on request — so a branding image has one variant.
 *
 * Empty URLs and 0×0 masters are treated as unset: `next/image` cannot lay
 * them out, and the header then keeps the site-name text.
 */
export const resolveTenantLogoVariant = (
  info: TenantSiteInfo | null
): TenantImageVariant | null => {
  const variant = info?.logoImageVariants?.[0];
  if (!(variant?.url.trim() && variant.width > 0 && variant.height > 0)) {
    return null;
  }
  return variant;
};
