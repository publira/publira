type HeadersLike = Pick<Headers, "get">;

/**
 * Turned to `false` for an install whose edge passes on forwarding headers a
 * caller wrote, such as a managed load balancer that leaves a caller's
 * `X-Forwarded-Host` untouched. The web apps then stop reading
 * `X-Forwarded-Host`, and `publira server`, which reads the same variable,
 * stops reading `Forwarded`.
 *
 * Nothing inside Next.js tells which peer a request came from, so this is a
 * statement about the edge rather than a per-request trust check. Left on, a
 * caller behind such an edge picks the tenant a page is rendered for, and the
 * host a form submission's origin is compared with.
 */
export const FORWARDED_HEADER_ENABLED_ENV = "PUBLIRA_FORWARDED_HEADER_ENABLED";

/** The values Go's `strconv.ParseBool` reads, case-insensitively. */
const TRUE_VALUES = new Set(["1", "t", "true"]);
const FALSE_VALUES = new Set(["0", "f", "false"]);

const isForwardedHeaderEnabled = (): boolean => {
  const value = (process.env[FORWARDED_HEADER_ENABLED_ENV] ?? "")
    .trim()
    .toLowerCase();
  if (value === "" || TRUE_VALUES.has(value)) {
    return true;
  }
  if (FALSE_VALUES.has(value)) {
    return false;
  }

  throw new Error(
    `${FORWARDED_HEADER_ENABLED_ENV} must be true or false, not ${JSON.stringify(value)}`
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
 * That is the `X-Forwarded-Host` the edge wrote, and `Host` when there is
 * none or {@link FORWARDED_HEADER_ENABLED_ENV} is `false`. `null` when the
 * request names no host at all.
 */
export const getRequestHost = (headers: HeadersLike): string | null => {
  if (isForwardedHeaderEnabled()) {
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
