/**
 * The destination an operator wrote on an announcement, or null when it is not
 * one this site may follow.
 *
 * An announcement's link is operator-authored rather than reader-supplied, but
 * it still reaches `redirect()` and an `href`, so the shape is checked here
 * rather than trusted: a path on this site, or an absolute `http(s)` URL.
 * `//evil.example` and `/\evil.example` read as paths to a human and as another
 * origin to a browser, which is why both are refused.
 */
export const toSafeAnnouncementLinkUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2048) {
    return null;
  }

  const isInternalPath =
    trimmed.startsWith("/") &&
    !trimmed.startsWith("//") &&
    !trimmed.startsWith("/\\");
  if (
    isInternalPath ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://")
  ) {
    return trimmed;
  }

  return null;
};
