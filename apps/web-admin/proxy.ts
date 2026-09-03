import type { Locale } from "@publira/i18n";
import { getTenantDomainCandidates } from "@publira/utils";
import { isHealthProbePath } from "@publira/utils/health";
import { applyResolvedLocaleCookie } from "@publira/utils/resolved-locale";
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
import { resolveTenantRouting } from "./lib/tenant";

const PUBLIC_PATHS = new Set([
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

export const proxy = async (request: NextRequest) => {
  const { pathname } = request.nextUrl;

  // Probes must not depend on tenant resolution or backend availability.
  if (isHealthProbePath(pathname)) {
    return NextResponse.next();
  }

  // Former Route Handler. GET must not clear the session (#655).
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
    ({ defaultLocale, tenantId } = await resolveTenantRouting(
      getTenantDomainCandidates(request.headers)
    ));
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

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = `/${tenantId}${pathname}`;

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
  matcher: ["/((?!api/v1/revalidate(?:/|$)|_next/static|_next/image).*)"],
};
