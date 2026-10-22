import type { Locale } from "@publira/i18n";
import { sharedMessage } from "@publira/i18n/catalog";
import { getClientAddress } from "@publira/utils/client-address";
import { isHealthProbePath } from "@publira/utils/health";
import { getTenantDomainCandidates } from "@publira/utils/request-host";
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
  createGoogleTagGatewayResolver,
  gatewayPathSegmentOf,
} from "./lib/google-tag-gateway";
import { forwardToGoogleTagGateway } from "./lib/google-tag-gateway-proxy";
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
const resolveGoogleTagGateway = createGoogleTagGatewayResolver(apiClient);

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
 * The path without its trailing slashes, or `null` for one that has none, or
 * for a Google tag gateway path, which is loaded with its slash. It stands in
 * for the redirect Next.js makes itself unless `skipTrailingSlashRedirect` is
 * set, which `next.config.ts` sets for the gateway's sake.
 */
const withoutTrailingSlash = (pathname: string): string | null => {
  if (
    pathname === "/" ||
    !pathname.endsWith("/") ||
    gatewayPathSegmentOf(pathname)
  ) {
    return null;
  }
  let end = pathname.length;
  while (end > 1 && pathname[end - 1] === "/") {
    end -= 1;
  }
  return pathname.slice(0, end);
};

/**
 * What answers a request before any tenant is resolved: a health probe, which
 * must not depend on tenant resolution or backend availability, and a path
 * with a trailing slash. `null` for every other request.
 */
const answerBeforeTenant = (request: NextRequest): NextResponse | null => {
  const { pathname } = request.nextUrl;
  if (isHealthProbePath(pathname)) {
    return NextResponse.next();
  }
  const slashless = withoutTrailingSlash(pathname);
  return slashless ? redirectToPathname(request, slashless, 308) : null;
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
    description: sharedMessage(
      "storefront.errors.suspended_description",
      locale
    ),
    locale,
    title: sharedMessage("storefront.errors.suspended_title", locale),
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

/**
 * Whether the URL names a locale prefix the unprefixed URL stands for. Only a
 * locale the tenant offers other than its default keeps its prefix: one naming
 * the default is redundant, and one naming a locale the tenant does not offer
 * lands on the default as well, so an old bookmark or a search result in a
 * language switched off still opens the page.
 */
const isDroppedPrefix = (
  locale: Locale | null,
  tenant: ResolvedTenant
): boolean =>
  locale !== null &&
  (locale === tenant.defaultLocale ||
    !tenant.supportedLocales.includes(locale));

/**
 * The answer of the tenant's Google tag gateway when the request is on its
 * current path, or `null` for any other path, which the site serves: a path
 * the tenant has since regenerated, or one of a tenant that left the gateway
 * mode, gets the site's 404. None of the site's cookies is forwarded, and none is
 * set on the way back. A setting it cannot read, such as a malformed
 * `PUBLIRA_TRUSTED_PROXIES`, answers `502` rather than throwing out of the
 * proxy.
 */
const forwardGoogleTagGatewayPath = async (
  request: NextRequest,
  tenantId: string
): Promise<NextResponse | null> => {
  const gatewayPathSegment = gatewayPathSegmentOf(request.nextUrl.pathname);
  if (!gatewayPathSegment) {
    return null;
  }
  const gateway = await resolveGoogleTagGateway(tenantId);
  if (gateway?.path !== gatewayPathSegment) {
    return null;
  }
  try {
    return await forwardToGoogleTagGateway(
      request,
      gateway,
      getClientAddress(request.headers)
    );
  } catch (error) {
    // A setting the gateway cannot read fails the gateway's path alone.
    console.error("[web-storefront] google tag gateway failed", error);
    return new NextResponse("Bad Gateway", { status: 502 });
  }
};

/**
 * {@link resolveTenant}, with the Google tag gateway's answer in place of the
 * tenant on its path: the gateway answers before anything that reads or clears
 * the reader's session.
 */
const resolveSiteTenant = async (
  request: NextRequest,
  pathLocale: Locale | null
): Promise<ResolvedTenant | { response: NextResponse }> => {
  const tenant = await resolveTenant(request, pathLocale);
  if ("response" in tenant) {
    return tenant;
  }
  const gatewayResponse = await forwardGoogleTagGatewayPath(
    request,
    tenant.tenantId
  );
  return gatewayResponse ? { response: gatewayResponse } : tenant;
};

const rewriteTo = (request: NextRequest, pathname: string): NextResponse => {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.rewrite(url);
};

export const proxy = async (request: NextRequest): Promise<NextResponse> => {
  const { pathname } = request.nextUrl;

  const answered = answerBeforeTenant(request);
  if (answered) {
    return answered;
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
  const tenant = await resolveSiteTenant(request, requestedLocale);
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

  // Preserve the path and query while dropping a prefix the unprefixed URL
  // stands for.
  if (isDroppedPrefix(requestedLocale, tenant)) {
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
