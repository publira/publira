import type { Locale } from "@publira/i18n";
import { sharedMessage } from "@publira/i18n/catalog";
import { getTenantDomainCandidates } from "@publira/utils";
import { isHealthProbePath } from "@publira/utils/health";
import { applyResolvedLocaleCookie } from "@publira/utils/resolved-locale";
import {
  suspendedTenantLocale,
  suspendedTenantResponse,
} from "@publira/utils/suspended-tenant";
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
import {
  buildTenantRewritePathname,
  getPublishedPageSlugFromPathname,
} from "./lib/published-page-path";
import { createPublishedPageSlugResolver } from "./lib/published-page-slugs";
import { GUEST_ONLY_PATHS, MEMBER_PATH_PREFIXES } from "./lib/reader-paths";
import {
  createTenantResolver,
  SUSPENDED_TENANT,
} from "./lib/tenant-resolution";
import type { ResolvedTenant } from "./lib/tenant-resolution";

const resolveTenantByDomain = createTenantResolver(apiClient);
const resolvePublishedPageSlugs = createPublishedPageSlugResolver(apiClient);

const GUEST_ONLY_PATH_SET: ReadonlySet<string> = new Set(GUEST_ONLY_PATHS);

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
 * Send the reader to another path on this host, keeping the query.
 *
 * The status says how long the answer holds: 307 for a redirect that follows a
 * setting, 308 for a URL that moved and is not coming back.
 */
const redirectToPathname = (
  request: NextRequest,
  pathname: string,
  status: 307 | 308 = 307
): NextResponse => {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.redirect(url, status);
};

/**
 * The `/creators` path a retired `/authors` URL now names, or `null` for a path
 * that never moved. The storefront's own links point at `/creators` directly,
 * so this only serves bookmarks and inbound links from before the move.
 */
const movedPublicPathname = (pathname: string): string | null => {
  if (pathname === "/authors") {
    return "/creators";
  }
  return pathname.startsWith("/authors/")
    ? `/creators/${pathname.slice("/authors/".length)}`
    : null;
};

/** The permanent redirect for a retired path, or `null` for a path that never moved. */
const redirectMovedPathname = (
  request: NextRequest,
  requestedLocale: Locale | null,
  pathname: string
): NextResponse | null => {
  const movedPathname = movedPublicPathname(pathname);
  if (!movedPathname) {
    return null;
  }
  return redirectToPathname(
    request,
    requestedLocale ? `/${requestedLocale}${movedPathname}` : movedPathname,
    308
  );
};

/**
 * What every path of a suspended tenant's site answers: the page saying the
 * site is unavailable, as a `503` a crawler takes for an absence that ends.
 *
 * It names the site's state and nothing else, since a reader has nothing to do
 * about a suspension but come back. The machine-facing paths answer the same
 * way: a payment provider retries a `503` on its own schedule, and a crawler
 * reads one on `robots.txt` as "not now" rather than "nothing here".
 */
const suspendedSiteResponse = (
  request: NextRequest,
  pathLocale: Locale | null
): NextResponse => {
  const locale = suspendedTenantLocale(request, pathLocale);
  return suspendedTenantResponse({
    description: sharedMessage("host.errors.suspended_description", locale),
    locale,
    title: sharedMessage("host.errors.suspended_title", locale),
  });
};

/**
 * The tenant this host resolves to, or the response that says why not.
 *
 * `pathLocale` is the locale the URL names, which is the language a suspended
 * tenant's page is written in when there is one.
 */
const resolveTenant = async (
  request: NextRequest,
  pathLocale: Locale | null
): Promise<ResolvedTenant | { response: NextResponse }> => {
  let tenant: ResolvedTenant | typeof SUSPENDED_TENANT | null;
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
  if (tenant === SUSPENDED_TENANT) {
    return { response: suspendedSiteResponse(request, pathLocale) };
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
    const tenant = await resolveTenant(request, null);
    if ("response" in tenant) {
      return tenant.response;
    }
    return rewriteTo(request, `/${tenant.tenantId}${pathname}`);
  }

  const { locale: requestedLocale, pathname: publicPath } =
    splitLocalePathname(pathname);
  const tenant = await resolveTenant(request, requestedLocale);
  if ("response" in tenant) {
    return tenant.response;
  }

  /**
   * Leave the default this request was routed by on the response. The document
   * the App Router returns names no language of its own — the root layout
   * reads nothing, so `<html lang>` is written by the inline script — and on
   * the unprefixed URL that serves this default, the path does not name it
   * either. `app/[tenant_id]/[locale]/error.tsx` resolves its copy from the
   * same cookie, for a render that happens because the tenant read failed.
   */
  const withResolvedLocale = (response: NextResponse) =>
    applyResolvedLocaleCookie(request, response, tenant.defaultLocale);

  // A published page is served at its slug in place of the redirects and
  // session rules below; the admin API keeps the paths they must hold.
  const publishedSlugs = await resolvePublishedPageSlugs(tenant.tenantId);
  const isPublishedPagePath =
    getPublishedPageSlugFromPathname(publicPath, publishedSlugs) !== null;

  // `/authors` moved to `/creators`, so it answers permanently — unlike the
  // locale prefix below, which follows a tenant setting that can change. It is
  // decided first so what a browser caches forever names the path alone: the
  // prefix the reader asked for rides along, and whether that prefix is
  // redundant stays the temporary redirect's decision.
  const movedResponse = isPublishedPagePath
    ? null
    : redirectMovedPathname(request, requestedLocale, publicPath);
  if (movedResponse) {
    return withResolvedLocale(movedResponse);
  }

  // A prefix is only canonical for a locale other than this tenant's default.
  // Preserve the path and query while removing a redundant default prefix.
  if (requestedLocale === tenant.defaultLocale) {
    return withResolvedLocale(redirectToPathname(request, publicPath));
  }

  // A prefix-less public path is served as the tenant's default locale. Unlike
  // the old compatibility redirect, this keeps the reader on the canonical
  // URL while the App Router receives its required `[locale]` segment.
  const locale = requestedLocale ?? tenant.defaultLocale;
  const rewritePathname = buildTenantRewritePathname(
    tenant.tenantId,
    locale,
    publicPath,
    publishedSlugs
  );

  if (isPublishedPagePath) {
    return withResolvedLocale(rewriteTo(request, rewritePathname));
  }

  const sessionCookie = request.cookies.get(PUBLIC_SESSION_COOKIE_NAME)?.value;
  const hasStoredSessionCookie = Boolean(sessionCookie?.trim());
  const hasSessionCookie = await hasActivePublicSessionCookie(sessionCookie);
  const isGuestOnlyPath = GUEST_ONLY_PATH_SET.has(publicPath);

  // The API rejected this session while a page was rendering, where the cookie
  // cannot be touched. Clearing it here is what stops the guest-only rule below
  // from bouncing the reader back to the route that just rejected them.
  const isRejectedSession =
    isGuestOnlyPath && isSessionRevokedRedirect(request.nextUrl);

  if (hasSessionCookie && isGuestOnlyPath && !isRejectedSession) {
    return withResolvedLocale(
      NextResponse.redirect(
        new URL(
          withLocalePrefix(locale, tenant.defaultLocale, "/my"),
          request.url
        )
      )
    );
  }

  if (!hasSessionCookie && isMemberPath(publicPath)) {
    return withResolvedLocale(
      redirectToLogin(
        request,
        locale,
        tenant.defaultLocale,
        hasStoredSessionCookie
      )
    );
  }

  const response = rewriteTo(request, rewritePathname);
  if (isRejectedSession && hasStoredSessionCookie) {
    response.cookies.delete(PUBLIC_SESSION_COOKIE_NAME);
  }
  return withResolvedLocale(response);
};

export const config = {
  matcher: [
    "/((?!api/v1/revalidate(?:/|$)|_next/static|_next/image|favicon.ico).*)",
  ],
};
