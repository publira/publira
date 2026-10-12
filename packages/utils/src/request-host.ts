type HeadersLike = Pick<Headers, "get">;

/**
 * Turned to `false` for an install whose edge writes `X-Forwarded-Host` and
 * passes on a `Forwarded` header the caller sent, as `publira server` reads
 * the same variable for the client address. The web apps then take the host
 * from `X-Forwarded-Host` and `Host` alone.
 */
export const FORWARDED_HEADER_ENABLED_ENV = "PUBLIRA_FORWARDED_HEADER_ENABLED";

/**
 * Exactly the values Go's `strconv.ParseBool` reads, so that a value
 * `publira server` accepts for the same variable is accepted here too, and
 * one it refuses is refused.
 */
const TRUE_VALUES = new Set(["1", "t", "T", "true", "TRUE", "True"]);
const FALSE_VALUES = new Set(["0", "f", "F", "false", "FALSE", "False"]);

const isForwardedHeaderEnabled = (): boolean => {
  const value = (process.env[FORWARDED_HEADER_ENABLED_ENV] ?? "").trim();
  if (value === "" || TRUE_VALUES.has(value)) {
    return true;
  }
  if (FALSE_VALUES.has(value)) {
    return false;
  }

  throw new Error(
    `${FORWARDED_HEADER_ENABLED_ENV} must be a boolean such as true or false, not ${JSON.stringify(value)}`
  );
};

/** Splits `value` at every `separator` outside a quoted string. */
const splitUnquoted = (value: string, separator: string): string[] => {
  const parts: string[] = [];
  let quoted = false;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if (quoted && character === "\\") {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === separator) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
};

const unquote = (value: string): string =>
  value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1).replaceAll(/\\(?<escaped>.)/gu, "$<escaped>")
    : value;

/**
 * The rightmost `host=` in `Forwarded` (RFC 7239), read across every element
 * the way `publira server` reads its `for=`.
 */
const forwardedHost = (headers: HeadersLike): string | undefined => {
  let host: string | undefined;
  for (const element of splitUnquoted(headers.get("forwarded") ?? "", ",")) {
    for (const pair of splitUnquoted(element, ";")) {
      const separator = pair.indexOf("=");
      if (
        separator !== -1 &&
        pair.slice(0, separator).trim().toLowerCase() === "host"
      ) {
        host = unquote(pair.slice(separator + 1).trim()) || host;
      }
    }
  }
  return host;
};

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
