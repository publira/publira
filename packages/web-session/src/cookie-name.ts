const COOKIE_SUFFIX_PATTERN = /^-[a-z][a-z0-9-]{0,31}$/u;

/**
 * Adds the selected local development profile to a Cookie name.
 *
 * Cookies are scoped by host, not port. Development profiles therefore use a
 * suffix when the same app is open on two profile-specific ports of localhost.
 * Deployments leave `PUBLIRA_COOKIE_SUFFIX` unset and retain their established
 * Cookie names.
 */
export const profileCookieName = (baseName: string): string => {
  const suffix = process.env.PUBLIRA_COOKIE_SUFFIX?.trim() ?? "";
  if (!suffix) {
    return baseName;
  }
  if (!COOKIE_SUFFIX_PATTERN.test(suffix)) {
    throw new Error("PUBLIRA_COOKIE_SUFFIX must match -[a-z][a-z0-9-]{0,31}");
  }
  return `${baseName}${suffix}`;
};
