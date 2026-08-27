import { headers } from "next/headers";
import { forbidden } from "next/navigation";

const isHttpOrigin = (value: URL): boolean =>
  value.protocol === "http:" || value.protocol === "https:";

const sameHost = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

const isMatchingOrigin = (value: string, host: string): boolean => {
  try {
    const origin = new URL(value);
    return (
      isHttpOrigin(origin) &&
      origin.origin === value &&
      sameHost(origin.host, host)
    );
  } catch {
    return false;
  }
};

const isMatchingReferer = (value: string, host: string): boolean => {
  try {
    const referer = new URL(value);
    return isHttpOrigin(referer) && sameHost(referer.host, host);
  } catch {
    return false;
  }
};

/**
 * Reject a mutation unless the browser sent it from this Platform host.
 *
 * #600 deliberately uses Origin/Referer validation instead of a double-submit
 * token. This compares the request's advertised origin with Host (or the
 * trusted proxy's X-Forwarded-Host) rather than a fixed deployment allowlist.
 * Route Handlers are outside this guard because web-platform only exposes
 * GET-only health checks.
 */
export const assertSameOrigin = async (): Promise<void> => {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host")?.trim() ??
    requestHeaders.get("host")?.trim();
  const origin = requestHeaders.get("origin")?.trim();

  if (!host) {
    forbidden();
  }

  if (origin) {
    if (!isMatchingOrigin(origin, host)) {
      forbidden();
    }
    return;
  }

  const referer = requestHeaders.get("referer")?.trim();
  if (!referer || !isMatchingReferer(referer, host)) {
    forbidden();
  }
};
