import {
  forwardedParameters,
  isForwardedHeaderEnabled,
} from "./forwarded-header";

export { FORWARDED_HEADER_ENABLED_ENV } from "./forwarded-header";

type HeadersLike = Pick<Headers, "get">;

/**
 * The rightmost `host=` in `Forwarded` (RFC 7239), read across every element
 * the way `publira server` reads its `for=`.
 */
const forwardedHost = (headers: HeadersLike): string | undefined =>
  forwardedParameters(headers.get("forwarded") ?? "", "host").findLast(
    (host) => host.length > 0
  );

/** The rightmost of `X-Forwarded-Host`'s values, the one the nearest hop wrote. */
const forwardedHostHeader = (headers: HeadersLike): string | undefined =>
  headers
    .get("x-forwarded-host")
    ?.split(",")
    .map((entry) => entry.trim())
    .findLast((entry) => entry.length > 0);

/**
 * The host the request was sent to, as the browser named it.
 *
 * That is the `host=` of `Forwarded`, the standard header, unless
 * {@link FORWARDED_HEADER_ENABLED_ENV} is `false`; then `X-Forwarded-Host`;
 * then `Host`, for a request no edge described. `null` when the request names
 * no host at all.
 */
export const getRequestHost = (headers: HeadersLike): string | null =>
  (isForwardedHeaderEnabled() ? forwardedHost(headers) : undefined) ??
  forwardedHostHeader(headers) ??
  (headers.get("host")?.trim() || null);

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
