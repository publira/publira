import type { TenantSiteInfo } from "./tenant";

interface TenantIconDescriptor {
  url: string;
}

/**
 * Narrower than `Metadata["icons"]`, which is a union wide enough that a caller
 * cannot read a field off it. Assignability to the metadata type is checked
 * where the layout hands the result to Next.js.
 */
interface TenantIcons {
  apple: TenantIconDescriptor[];
  icon: TenantIconDescriptor[];
}

/**
 * Icons for the public site. The uploaded tenant icon is already a
 * square PNG by the time the image server hands it out
 * (`imageproc.BuildIcon`), so it is linked as it is served; a tenant without
 * one has no icon variant, declares no icon, and keeps the browser's
 * default.
 *
 * No `type` / `sizes` on the link: the image server negotiates the encoding
 * from the browser's `Accept`, so the bytes are not always the stored PNG, and
 * it resizes the stored master on request rather than serving fixed sizes.
 */
export const resolveTenantIcons = (
  info: TenantSiteInfo | null
): TenantIcons | undefined => {
  const iconUrl = info?.iconImageVariants?.[0]?.url.trim();
  if (!iconUrl) {
    return undefined;
  }

  return { apple: [{ url: iconUrl }], icon: [{ url: iconUrl }] };
};
