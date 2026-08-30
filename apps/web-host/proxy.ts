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
  defaultLocale: Locale,
  clearSession = false
) => {
  const response = NextResponse.redirect(
    buildLoginUrl(request.nextUrl, locale, defaultLocale)
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
 * Remove an explicit tenant-default locale prefix. Public URLs use that locale
 * without a prefix, while the App Router still receives it after the rewrite.
 */
const redirectToCanonicalPath = (
  request: NextRequest,
  pathname: string
): NextResponse => {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
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

  const { locale: requestedLocale, pathname: publicPath } =
    splitLocalePathname(pathname);
  const tenant = await resolveTenant(request);
  if ("response" in tenant) {
    return tenant.response;
  }

  // A prefix is only canonical for a locale other than this tenant's default.
  // Preserve the path and query while removing a redundant default prefix.
  if (requestedLocale === tenant.defaultLocale) {
    return redirectToCanonicalPath(request, publicPath);
  }

  // A prefix-less public path is served as the tenant's default locale. Unlike
  // the old compatibility redirect, this keeps the reader on the canonical
  // URL while the App Router receives its required `[locale]` segment.
  const locale = requestedLocale ?? tenant.defaultLocale;

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
      new URL(
        withLocalePrefix(locale, tenant.defaultLocale, "/my"),
        request.url
      )
    );
  }

  if (!hasSessionCookie && isMemberPath(publicPath)) {
    return redirectToLogin(
      request,
      locale,
      tenant.defaultLocale,
      hasStoredSessionCookie
    );
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
