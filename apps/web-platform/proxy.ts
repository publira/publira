import { isLocale, negotiateInitialLocale } from "@publira/i18n";
import {
  consoleLocalePathname,
  consoleRequestLocale,
} from "@publira/locale/console-locale";
import { isHealthProbePath } from "@publira/utils/health";
import { applyResolvedLocaleCookie } from "@publira/utils/resolved-locale";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  buildLoginUrl,
  buildReturnToPath,
  hasActivePlatformSessionCookie,
  isSessionRevokedRedirect,
  PLATFORM_SESSION_COOKIE_NAME,
  RETURN_TO_HEADER_NAME,
} from "./lib/auth-shared";
import { resolveSetupState } from "./lib/setup";

/**
 * The change-password URL a password manager opens. It only redirects to
 * `/reset-password`, so it is public too, but only once there is an account to
 * reset.
 */
const CHANGE_PASSWORD_PATH = "/.well-known/change-password";

const PUBLIC_PATHS = new Set([
  CHANGE_PASSWORD_PATH,
  "/confirm-email",
  "/confirm-password",
  "/livez",
  "/login",
  // Reached between the password and the session, so it has neither yet.
  "/mfa",
  "/readyz",
  "/reset-password",
  "/reset-password/requested",
  "/setup",
]);

/**
 * Whether `pathname` is answered by a Route Handler at the root of `app/`
 * rather than by a page under `app/[locale]/`. A Route Handler cannot read
 * `next/root-params`, so these are the requests the proxy lets through on the
 * path they arrived on instead of rewriting them onto a locale.
 */
const isRouteHandlerPath = (pathname: string): boolean =>
  pathname === CHANGE_PASSWORD_PATH || pathname.startsWith("/api/");

export const proxy = async (request: NextRequest) => {
  const { pathname } = request.nextUrl;

  // Probes must not depend on setup state or backend availability.
  if (isHealthProbePath(pathname)) {
    return NextResponse.next();
  }

  // Former Route Handler. GET must not clear the session.
  if (pathname === "/logout") {
    return new NextResponse("Not Found", { status: 404 });
  }

  // The console ships no favicon, and a path the matcher skipped would still
  // reach the app router unrewritten — where `/[locale]` is the one route that
  // matches it, with `favicon.ico` standing in for the locale. Every browser
  // asks for it on every page, so it is answered here instead.
  if (pathname === "/favicon.ico") {
    return new NextResponse("Not Found", { status: 404 });
  }

  // The saved default locale rides along on the read the routing decision needs
  // anyway, and every response below carries it to the browser: it is the only
  // way `<html lang>` and the client error boundary get to name the language the
  // platform saved rather than the one the visitor's browser asked for.
  const { completed: setupCompleted, defaultLocale } =
    await resolveSetupState();

  const withLocale = (response: NextResponse) =>
    applyResolvedLocaleCookie(request, response, defaultLocale);

  // Every page lives under the `[locale]` root segment, and the URL never names
  // it: the request is rewritten onto the locale resolved here, so a Server
  // Component reads it as a root parameter. A path that already starts with a
  // locale is rewritten like any other and matches nothing, so the path never
  // selects the language. Redirects keep naming the public, unprefixed paths.
  // Cookie, then the saved default `resolveSetupState()` carries, and
  // `Accept-Language` only while nothing is saved — the order
  // `getPlatformLocale()` resolves. The saved value stays in this file: an
  // outage keeps the last language the API confirmed.
  const storedDefault = isLocale(defaultLocale)
    ? defaultLocale
    : negotiateInitialLocale(request.headers.get("accept-language"));

  const localizedUrl = request.nextUrl.clone();
  localizedUrl.pathname = consoleLocalePathname(
    pathname,
    consoleRequestLocale(request, storedDefault)
  );

  const pass = (init?: { request: { headers: Headers } }) =>
    isRouteHandlerPath(pathname)
      ? NextResponse.next(init)
      : NextResponse.rewrite(localizedUrl, init);

  // The setup screen renders in a locale too, so it waits for the read above.
  // `resolveSetupState()` never throws, so the screen is still answered while
  // the API is unreachable.
  if (pathname === "/setup") {
    return withLocale(pass());
  }

  if (
    !setupCompleted &&
    (pathname === "/login" || pathname === CHANGE_PASSWORD_PATH)
  ) {
    return withLocale(NextResponse.redirect(new URL("/setup", request.url)));
  }

  const sessionCookie = request.cookies.get(
    PLATFORM_SESSION_COOKIE_NAME
  )?.value;

  const hasStoredSessionCookie = Boolean(sessionCookie?.trim());

  if (PUBLIC_PATHS.has(pathname)) {
    const response = pass();

    // The API rejected this session while a page was rendering, where the
    // cookie cannot be touched. Clearing it here is what keeps the console from
    // waving the operator back in with the same dead credentials.
    if (hasStoredSessionCookie && isSessionRevokedRedirect(request.nextUrl)) {
      response.cookies.delete(PLATFORM_SESSION_COOKIE_NAME);
    }

    return withLocale(response);
  }

  if (await hasActivePlatformSessionCookie(sessionCookie)) {
    // The console cannot read the URL it is serving, so the path travels with
    // the request: a layout, a page, or a Server Action whose RPC comes back
    // `unauthenticated` sends the operator to `/login?next=` here.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(
      RETURN_TO_HEADER_NAME,
      buildReturnToPath(request.nextUrl)
    );

    return withLocale(pass({ request: { headers: requestHeaders } }));
  }

  const response = setupCompleted
    ? NextResponse.redirect(buildLoginUrl(request.nextUrl))
    : NextResponse.redirect(new URL("/setup", request.url));

  // A cookie that no longer decrypts or has run out is not worth carrying to
  // the login page, where it would only be rejected again.
  if (hasStoredSessionCookie) {
    response.cookies.delete(PLATFORM_SESSION_COOKIE_NAME);
  }

  return withLocale(response);
};

export const config = {
  matcher: ["/((?!api/v1/revalidate(?:/|$)|_next/static|_next/image).*)"],
};
