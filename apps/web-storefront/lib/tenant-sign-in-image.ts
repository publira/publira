import type { TenantImageVariant, TenantSiteInfo } from "./tenant";

/**
 * The variant the panel beside the sign-in and sign-up forms should render.
 * The server keeps the upload's own proportions and the panel crops it to the
 * window, so the image has one variant, as the logo does.
 *
 * Empty URLs and 0×0 masters are treated as unset: `next/image` cannot lay
 * them out, and the panel then shows the tenant's colours instead.
 */
export const resolveTenantSignInImageVariant = (
  info: Pick<TenantSiteInfo, "signInImageVariants"> | null
): TenantImageVariant | null => {
  const variant = info?.signInImageVariants?.[0];
  if (!(variant?.url.trim() && variant.width > 0 && variant.height > 0)) {
    return null;
  }
  return variant;
};
