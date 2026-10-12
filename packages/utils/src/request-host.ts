type HeadersLike = Pick<Headers, "get">;

/**
 * Turns on reading `X-Forwarded-Host`, for an install whose edge rewrites
 * `Host` on its way to the web apps.
 *
 * Nothing inside Next.js tells which peer a request came from, so this is a
 * statement about the edge rather than a per-request trust check: it is safe
 * only when every edge in front of the apps overwrites the header itself. A
 * managed load balancer that passes a caller's `X-Forwarded-Host` on untouched
 * would hand that caller the choice of tenant, and the host a form
 * submission's origin is compared with.
 */
export const X_FORWARDED_HOST_ENABLED_ENV = "PUBLIRA_X_FORWARDED_HOST_ENABLED";

/** The values Go's `strconv.ParseBool` reads, case-insensitively. */
const TRUE_VALUES = new Set(["1", "t", "true"]);
const FALSE_VALUES = new Set(["0", "f", "false"]);

const isXForwardedHostEnabled = (): boolean => {
  const value = (process.env[X_FORWARDED_HOST_ENABLED_ENV] ?? "")
    .trim()
    .toLowerCase();
  if (value === "" || FALSE_VALUES.has(value)) {
    return false;
  }
  if (TRUE_VALUES.has(value)) {
    return true;
  }

  throw new Error(
    `${X_FORWARDED_HOST_ENABLED_ENV} must be true or false, not ${JSON.stringify(value)}`
  );
};

/**
 * The rightmost of a comma-separated header's values, the one the nearest hop
 * wrote when an edge appended to rather than replaced the header.
 */
const lastHeaderValue = (
  headers: HeadersLike,
  name: string
): string | undefined =>
  headers
    .get(name)
    ?.split(",")
    .map((entry) => entry.trim())
    .findLast((entry) => entry.length > 0);

/**
 * The host the request was sent to, as the browser named it.
 *
 * That is `Host`, which every supported edge passes on unchanged. With
 * {@link X_FORWARDED_HOST_ENABLED_ENV} on, a present `X-Forwarded-Host` takes
 * its place. `null` when the request names no host at all.
 */
export const getRequestHost = (headers: HeadersLike): string | null => {
  if (isXForwardedHostEnabled()) {
    const forwarded = lastHeaderValue(headers, "x-forwarded-host");
    if (forwarded) {
      return forwarded;
    }
  }

  return headers.get("host")?.trim() || null;
};

const normalizeRequestHost = (value: string): string => {
  let host = value.trim().toLowerCase();
  const scheme = host.indexOf("://");
  if (scheme !== -1) {
    host = host.slice(scheme + 3);
  }

  const slash = host.indexOf("/");
  if (slash !== -1) {
    host = host.slice(0, slash);
  }

  return host;
};

/** The stored tenant domains {@link getRequestHost} can match. */
export const getTenantDomainCandidates = (headers: HeadersLike): string[] => {
  const host = getRequestHost(headers);
  if (!host) {
    return [];
  }

  const normalized = normalizeRequestHost(host);
  return normalized.length > 0 ? [normalized] : [];
};
