import { LOCALE_COOKIE_NAME, parseLocaleCookie } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedMessage } from "@publira/i18n/catalog";
import { isHealthProbePath } from "@publira/utils/health";
import { getTenantDomainCandidates } from "@publira/utils/request-host";
import { applyResolvedLocaleCookie } from "@publira/utils/resolved-locale";
import {
  suspendedTenantLocale,
  suspendedTenantResponse,
} from "@publira/utils/suspended-tenant";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ADMIN_SESSION_COOKIE_NAME,
  buildLoginUrl,
  buildReturnToPath,
  hasActiveAdminSessionCookie,
  isSessionRevokedRedirect,
  RETURN_TO_HEADER_NAME,
} from "./lib/admin-auth-shared";
import { resolveTenantRouting, SUSPENDED_TENANT } from "./lib/tenant";

const CHANGE_PASSWORD_PATH = "/.well-known/change-password";

const PUBLIC_PATHS = new Set([
  // A password manager opens it signed in or not, and it only redirects to
  // `/forgot-password`, which is public too.
  CHANGE_PASSWORD_PATH,
  "/accept-invite",
  "/confirm-email",
  "/confirm-password",
  "/forgot-password",
  "/livez",
  "/login",
  // The second half of a login: a password has been accepted, but the session
  // it earns is not issued until the factor is settled, so this screen is
  // reached without a session cookie.
  "/mfa",
  "/readyz",
  "/theme.css",
]);

const serviceUnavailableResponse = () =>
  new NextResponse("Service Unavailable", {
    headers: { "Retry-After": "30" },
    status: 503,
  });

/**
 * What every path of a suspended tenant's console answers, the sign-in screen
 * included: the page saying the console is unavailable because the site is
 * suspended.
 *
 * It is answered before the session cookie is looked at. A suspension does not
 * end the staff's sessions, so the cookie is left where it is, and the console
 * opens with it again once the tenant is resumed.
 */
const suspendedConsoleResponse = (request: NextRequest): NextResponse => {
  const locale = suspendedTenantLocale(request);

  return suspendedTenantResponse({
    locale,
    description: sharedMessage("admin.errors.suspended_description", locale),
    title: sharedMessage("admin.errors.suspended_title", locale),
  });
};

/**
 * Whether `pathname` is answered by a Route Handler under `app/[tenant_id]/`
 * rather than by a page under `app/[tenant_id]/[locale]/`. A Route Handler
 * cannot read `next/root-params`, so these are the requests the proxy rewrites
 * onto the tenant alone instead of onto a locale as well.
 */
const isRouteHandlerPath = (pathname: string): boolean =>
  pathname === CHANGE_PASSWORD_PATH ||
  pathname === "/theme.css" ||
  pathname.startsWith("/api/");

/**
 * The locale a page request is rendered in, in the order `getAdminLocale()` in
 * `lib/locale.ts` resolves it: a supported `publira_locale` cookie, then the
 * tenant's stored default. `null` when neither names a language this build
 * serves a catalog for.
 */
const resolveRequestLocale = (
  request: NextRequest,
  defaultLocale: Locale | null
): Locale | null =>
  parseLocaleCookie(request.cookies.get(LOCALE_COOKIE_NAME)?.value) ??
  defaultLocale;

export const proxy = async (request: NextRequest) => {
  const { pathname } = request.nextUrl;

  // Probes must not depend on tenant resolution or backend availability.
  if (isHealthProbePath(pathname)) {
    return NextResponse.next();
  }

  // Former Route Handler. GET must not clear the session.
  if (pathname === "/logout") {
    return new NextResponse("Not Found", { status: 404 });
  }

  // The console ships no favicon, and a path the matcher skips still reaches
  // the app router — where the only route that matches is `/[tenant_id]`, with
  // `favicon.ico` standing in for the tenant. Every browser asks for it on
  // every page, so answering here is what keeps that tree from rendering, and
  // its `generateMetadata` from reading request state, once per page view.
  // Serving an icon means adding the file convention and dropping this branch.
  if (pathname === "/favicon.ico") {
    return new NextResponse("Not Found", { status: 404 });
  }

  // The saved default locale rides along on the read the Host-to-tenant
  // resolution needs anyway, and every response below carries it to the
  // browser: it is the only way `<html lang>` and the client error boundary get
  // to name the language the tenant saved rather than the one the visitor's
  // browser asked for.
  let tenantId: string | null;
  let defaultLocale: Locale | null;

  try {
    const routing = await resolveTenantRouting(
      getTenantDomainCandidates(request.headers)
    );

    if (routing === SUSPENDED_TENANT) {
      return suspendedConsoleResponse(request);
    }

    ({ defaultLocale, tenantId } = routing);
  } catch {
    return serviceUnavailableResponse();
  }

  if (!tenantId) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // `resolveTenantRouting` throws on a read it could not make, and that answered
  // 503 above, so reaching here means the API answered: a locale it named, or
  // `"none"` for a code this build serves no catalog for, which expires the
  // cookie an earlier answer left behind rather than leaving a stale language
  // standing.
  const withLocale = (response: NextResponse) =>
    applyResolvedLocaleCookie(request, response, defaultLocale ?? "none");

  // Every page lives under the `[locale]` root segment, and the URL never names
  // it: the request is rewritten onto the locale resolved here, so a Server
  // Component reads it as a root parameter. A path that already starts with a
  // locale is rewritten like any other and matches nothing, so the path never
  // selects the language. Redirects keep naming the public paths.
  const rewriteUrl = request.nextUrl.clone();

  if (isRouteHandlerPath(pathname)) {
    rewriteUrl.pathname = `/${tenantId}${pathname}`;
  } else {
    const locale = resolveRequestLocale(request, defaultLocale);

    // A page neither the operator nor the tenant names a language for has no
    // language to render in: the tenant's stored default is a code this build
    // serves no catalog for. It ends here, the way the storefront's proxy ends
    // it, rather than rendering the console in a language nobody chose.
    if (!locale) {
      return withLocale(serviceUnavailableResponse());
    }

    rewriteUrl.pathname = `/${tenantId}/${locale}${
      pathname === "/" ? "" : pathname
    }`;
  }

  const sessionCookie = request.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value;
  const hasStoredSessionCookie = Boolean(sessionCookie?.trim());

  if (PUBLIC_PATHS.has(pathname)) {
    const response = NextResponse.rewrite(rewriteUrl);

    // The API rejected this session while a page was rendering, where the
    // cookie cannot be touched. Clearing it here is what keeps the console from
    // waving the operator back in with the same dead credentials.
    if (hasStoredSessionCookie && isSessionRevokedRedirect(request.nextUrl)) {
      response.cookies.delete(ADMIN_SESSION_COOKIE_NAME);
    }

    return withLocale(response);
  }

  if (await hasActiveAdminSessionCookie(sessionCookie)) {
    // The console cannot read the URL it is serving, so the path travels with
    // the request: a layout, a page, or a Server Action whose RPC comes back
    // `unauthenticated` sends the operator to `/login?next=` here.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(
      RETURN_TO_HEADER_NAME,
      buildReturnToPath(request.nextUrl)
    );

    return withLocale(
      NextResponse.rewrite(rewriteUrl, {
        request: { headers: requestHeaders },
      })
    );
  }

  const response = NextResponse.redirect(buildLoginUrl(request.nextUrl));

  // A cookie that no longer decrypts or has run out is not worth carrying to
  // the login page, where it would only be rejected again.
  if (hasStoredSessionCookie) {
    response.cookies.delete(ADMIN_SESSION_COOKIE_NAME);
  }

  return withLocale(response);
};

export const config = {
  // The page upload (`lib/episode-pages-upload.ts`) and the import from a ZIP
  // are left out because Next.js copies the body of every request the proxy
  // sees, up to a cap past which it silently drops the rest; the routes resolve
  // the tenant and the session themselves before they read the body.
  matcher: [
    "/((?!api/v1/revalidate(?:/|$)|api/v1/episode-pages(?:/|$)|api/v1/series-import(?:/|$)|_next/static|_next/image).*)",
  ],
};
