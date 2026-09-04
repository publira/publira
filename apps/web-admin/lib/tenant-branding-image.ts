import type { TenantImageVariant } from "@publira/api-client/admin/types";

/**
 * The theme's icon and logo arrive the way the eye-catch images do — the
 * image's `updated_at` plus its variants — rather than as a URL string. A
 * tenant that has not uploaded one has no variants, so an empty list is how a
 * screen tells "unset" from "set".
 */
export interface TenantBrandingImageVariant {
  label: string;
  variantType: string;
  url: string;
  contentType: string;
  width: number;
  height: number;
  fileSizeBytes: number;
}

export interface TenantBrandingImage {
  updatedAt: string;
  variants: TenantBrandingImageVariant[];
}

/**
 * The generated `TenantImageVariant` fields {@link toVariants} reads. Naming
 * them against the message type is what makes a proto rename fail here — a
 * restated structural type keeps compiling, the empty string it substitutes
 * fails the check below, and the card then reads as "Not set" with nothing
 * pointing at the cause.
 */
type RawTenantImageVariant = Pick<
  TenantImageVariant,
  | "contentType"
  | "fileSizeBytes"
  | "height"
  | "label"
  | "url"
  | "variantType"
  | "width"
>;

const toVariants = (
  variants: RawTenantImageVariant[] | undefined
): TenantBrandingImageVariant[] =>
  (variants ?? []).flatMap((variant) => {
    const mapped = {
      contentType: variant.contentType ?? "",
      fileSizeBytes: Number(variant.fileSizeBytes ?? 0),
      height: variant.height ?? 0,
      label: variant.label ?? "",
      url: variant.url ?? "",
      variantType: variant.variantType ?? "",
      width: variant.width ?? 0,
    };
    // The preview lays out at the stored master's own width and height, so a
    // variant that arrives without them would render at 0x0. Dropping it leaves
    // the card in its "unset" state instead of showing an invisible image.
    return mapped.label.length > 0 &&
      mapped.url.length > 0 &&
      mapped.width > 0 &&
      mapped.height > 0
      ? [mapped]
      : [];
  });

/** `null` when the tenant has not uploaded this image. */
export const toTenantBrandingImage = (
  updatedAt: string | undefined,
  variants: RawTenantImageVariant[] | undefined
): TenantBrandingImage | null => {
  const mapped = toVariants(variants);
  if (mapped.length === 0) {
    return null;
  }
  return { updatedAt: updatedAt?.trim() ?? "", variants: mapped };
};

/**
 * The variant a preview should render. `variantType` names what the image is
 * for, not a size — the image server resizes the stored master on request — so
 * a branding image has one variant and this returns it.
 */
export const tenantBrandingVariant = (
  image: TenantBrandingImage | null
): TenantBrandingImageVariant | null => image?.variants[0] ?? null;
