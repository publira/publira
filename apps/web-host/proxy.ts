import type { Locale } from "@publira/i18n";
import { getTenantDomainCandidates } from "@publira/utils";
import { isHealthProbePath } from "@publira/utils/health";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiClient } from "./lib/api-client";
import {
  buildLoginUrl,
  hasActivePublicSessionCookie,
  isSessionRevokedRedirect,
  PUBLIC_SESSION_COOKIE_NAME,
} from "./lib/auth-shared";
import {
  isLocaleExemptPathname,
  splitLocalePathname,
  withLocalePrefix,
} from "./lib/locale-path";
import { buildTenantRewritePathname } from "./lib/published-page-path";
import { createTenantResolver } from "./lib/tenant-resolution";
import type { ResolvedTenant } from "./lib/tenant-resolution";

const resolveTenantByDomain = createTenantResolver(apiClient);

// `/notifications` is the personal inbox. `/settings/notifications` is the
// email-preference screen and stays under `/settings`.
const MEMBER_PATH_PREFIXES = [
  "/my",
  "/announcements",
  "/notifications",
  "/settings",
] as const;
const GUEST_ONLY_PATHS = new Set(["/login", "/signup"]);

const isMemberPath = (pathname: string): boolean =>
  MEMBER_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

const redirectToLogin = (
  request: NextRequest,
  locale: Locale,
  clearSession = false
) => {
  const response = NextResponse.redirect(
    buildLoginUrl(request.nextUrl, locale)
  );
  if (clearSession) {
    response.cookies.delete(PUBLIC_SESSION_COOKIE_NAME);
  }
  return response;
};

const serviceUnavailableResponse = () =>
  new NextResponse("Service Unavailable", {
    headers: { "Retry-After": "30" },
    status: 503,
  });

/**
 * Send a URL from before the locale prefix existed to the tenant's own default
 * locale — the setting `GetTenantByDomain` returns alongside the tenant id, so
 * this costs no extra round trip.
 *
 * Temporary on purpose: a permanent redirect would be cached by the browser,
 * and neither a change to that setting nor the day this site negotiates a
 * locale from `Accept-Language` would reach a reader already pinned to
 * whatever they were first sent to.
 */
const redirectToTenantLocale = (
  request: NextRequest,
  locale: Locale
): NextResponse => {
  const url = request.nextUrl.clone();
  url.pathname = withLocalePrefix(locale, request.nextUrl.pathname);
  return NextResponse.redirect(url);
};

/** The tenant this host resolves to, or the response that says why not. */
const resolveTenant = async (
  request: NextRequest
): Promise<ResolvedTenant | { response: NextResponse }> => {
  let tenant: ResolvedTenant | null;
  try {
    tenant = await resolveTenantByDomain(
      getTenantDomainCandidates(request.headers)
    );
  } catch {
    return { response: serviceUnavailableResponse() };
  }

  if (!tenant) {
    return { response: new NextResponse("Not Found", { status: 404 }) };
  }

  return tenant;
};

const rewriteTo = (request: NextRequest, pathname: string): NextResponse => {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.rewrite(url);
};

export const proxy = async (request: NextRequest): Promise<NextResponse> => {
  const { pathname } = request.nextUrl;

  // Probes must not depend on tenant resolution or backend availability.
  if (isHealthProbePath(pathname)) {
    return NextResponse.next();
  }

  // `/theme.css` and the Route Handlers answer machines rather than readers,
  // and Route Handlers cannot read `next/root-params`, so they are rewritten
  // onto the tenant alone and never gain a locale segment.
  if (isLocaleExemptPathname(pathname)) {
    const tenant = await resolveTenant(request);
    if ("response" in tenant) {
      return tenant.response;
    }
    return rewriteTo(request, `/${tenant.tenantId}${pathname}`);
  }

  const { locale, pathname: publicPath } = splitLocalePathname(pathname);

  // `/privacy`, `/series/SR01` — a bookmark from before the locale prefix.
  // Which language it lands in is the tenant's decision, so the Host has to be
  // resolved before the redirect can be written.
  if (!locale) {
    const tenant = await resolveTenant(request);
    if ("response" in tenant) {
      return tenant.response;
    }
    return redirectToTenantLocale(request, tenant.defaultLocale);
  }

  const sessionCookie = request.cookies.get(PUBLIC_SESSION_COOKIE_NAME)?.value;
  const hasStoredSessionCookie = Boolean(sessionCookie?.trim());
  const hasSessionCookie = await hasActivePublicSessionCookie(sessionCookie);
  const isGuestOnlyPath = GUEST_ONLY_PATHS.has(publicPath);

  // The API rejected this session while a page was rendering, where the cookie
  // cannot be touched. Clearing it here is what stops the guest-only rule below
  // from bouncing the reader back to the route that just rejected them.
  const isRejectedSession =
    isGuestOnlyPath && isSessionRevokedRedirect(request.nextUrl);

  if (hasSessionCookie && isGuestOnlyPath && !isRejectedSession) {
    return NextResponse.redirect(
      new URL(withLocalePrefix(locale, "/my"), request.url)
    );
  }

  if (!hasSessionCookie && isMemberPath(publicPath)) {
    return redirectToLogin(request, locale, hasStoredSessionCookie);
  }

  const tenant = await resolveTenant(request);
  if ("response" in tenant) {
    return tenant.response;
  }

  // Single-segment published pages (admin slugs) rewrite to /page/[slug].
  const response = rewriteTo(
    request,
    buildTenantRewritePathname(tenant.tenantId, locale, publicPath)
  );
  if (isRejectedSession && hasStoredSessionCookie) {
    response.cookies.delete(PUBLIC_SESSION_COOKIE_NAME);
  }
  return response;
};

export const config = {
  matcher: [
    "/((?!api/v1/revalidate(?:/|$)|_next/static|_next/image|favicon.ico).*)",
  ],
};
