import type { UserIconVariant } from "@publira/api-client/admin/types";

/** The icon an account shows, as the console draws it. */
export interface ReaderIconImage {
  height: number;
  url: string;
  width: number;
}

/**
 * The icon an account's variants describe, or `null` for one that shows none.
 * An icon is stored as a single rendition, so the first variant is the icon;
 * image-server scales it to whatever size a screen draws it at.
 */
export const toReaderIconImage = (
  variants: readonly Pick<UserIconVariant, "height" | "url" | "width">[]
): ReaderIconImage | null => {
  const [variant] = variants;
  return variant
    ? { height: variant.height, url: variant.url, width: variant.width }
    : null;
};
