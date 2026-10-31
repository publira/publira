import type { UserIconVariant } from "@publira/api-client/public/types";

import type { AccountIcon } from "./auth";

/**
 * The limits `AuthService.UploadMyIcon` holds an upload to, checked before the
 * upload is sent so a file the API would refuse is not carried across the
 * network first. The API stays the authority: what passes here can still be
 * refused, and the settings screen shows that refusal as it comes back.
 */
export const ACCOUNT_ICON_MAX_BYTES = 10 * 1024 * 1024;

/** The shortest side a square can be cut to and still be stored. */
export const ACCOUNT_ICON_MIN_DIMENSION = 128;

/**
 * The formats offered for an icon, the same three the console offers for an
 * author's. The API takes any `image/*` it can decode, so a HEIC or an SVG is
 * turned away here rather than after the upload.
 */
export const ACCOUNT_ICON_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/** Why a picked file cannot become an icon. */
export type AccountIconFileProblem = "too-large" | "too-small" | "unsupported";

const isAcceptedContentType = (type: string): boolean =>
  (ACCOUNT_ICON_CONTENT_TYPES as readonly string[]).includes(type);

/**
 * The checks that need nothing but the file's own metadata, which is all the
 * Route Handler has before it hands the bytes to the API.
 */
export const checkAccountIconFile = (file: {
  size: number;
  type: string;
}): AccountIconFileProblem | null => {
  if (!isAcceptedContentType(file.type)) {
    return "unsupported";
  }

  if (file.size === 0) {
    return "unsupported";
  }

  if (file.size > ACCOUNT_ICON_MAX_BYTES) {
    return "too-large";
  }

  return null;
};

/**
 * {@link checkAccountIconFile} plus the image's dimensions, which the browser
 * can read by decoding it: the API cuts a square from the centre, so the
 * shorter side is the side the icon gets.
 */
export const checkAccountIconImage = async (
  file: Blob
): Promise<AccountIconFileProblem | null> => {
  const problem = checkAccountIconFile(file);

  if (problem) {
    return problem;
  }

  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return "unsupported";
  }

  const shorterSide = Math.min(bitmap.width, bitmap.height);
  bitmap.close();

  return shorterSide < ACCOUNT_ICON_MIN_DIMENSION ? "too-small" : null;
};

/**
 * The icon an account's variants describe, or `null` for one that shows none.
 * An icon is stored as a single rendition, so the first variant is the icon;
 * image-server scales it to whatever size a page draws it at.
 */
export const toAccountIcon = (
  variants: readonly Pick<UserIconVariant, "height" | "url" | "width">[]
): AccountIcon | null => {
  const [variant] = variants;

  return variant
    ? { height: variant.height, url: variant.url, width: variant.width }
    : null;
};
