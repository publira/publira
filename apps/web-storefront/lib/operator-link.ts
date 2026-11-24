import { isSameOriginPath } from "@publira/utils";

/**
 * The destination an operator wrote on an announcement or a campaign banner,
 * or null when it is not one this site may follow.
 *
 * Such a link is operator-authored rather than reader-supplied, but it still
 * reaches `redirect()` and an `href`, so the shape is checked here
 * rather than trusted: a path on this site, or an absolute `http(s)` URL.
 */
export const toSafeOperatorLinkUrl = (value: string): string | null => {
  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > 2048) {
    return null;
  }

  if (
    isSameOriginPath(trimmed) ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://")
  ) {
    return trimmed;
  }

  return null;
};
