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
 * Whether the browser sent this request from this tenant's host.
 *
 * This app deliberately uses Origin/Referer validation instead of a
 * double-submit token. Tenant hosts are dynamic, so this compares the
 * request's advertised origin with Host (or the trusted proxy's
 * X-Forwarded-Host) rather than a fixed deployment allowlist.
 *
 * The headers are a parameter rather than read here, because a Route Handler
 * already holds the request and answers a rejection with a status code, while
 * a Server Action reads the ambient request and answers with `forbidden()`.
 */
export const isSameOriginRequest = (requestHeaders: {
  get: (name: string) => string | null;
}): boolean => {
  const host =
    requestHeaders.get("x-forwarded-host")?.trim() ??
    requestHeaders.get("host")?.trim();
  if (!host) {
    return false;
  }

  const origin = requestHeaders.get("origin")?.trim();
  if (origin) {
    return isMatchingOrigin(origin, host);
  }

  const referer = requestHeaders.get("referer")?.trim();
  return referer !== undefined && isMatchingReferer(referer, host);
};

/**
 * Reject a Server Action unless {@link isSameOriginRequest} accepts it.
 *
 * The Route Handlers that skip this guard each say why in their own file: the
 * revalidation endpoint uses its own bearer token, Stripe verifies its webhook
 * signature upstream, and the rest are GET-only.
 */
export const assertSameOrigin = async (): Promise<void> => {
  if (!isSameOriginRequest(await headers())) {
    forbidden();
  }
};
