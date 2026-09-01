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

const PUBLIC_PATHS = new Set([
  "/confirm-email",
  "/confirm-password",
  "/livez",
  "/login",
  "/readyz",
  "/reset-password",
  "/reset-password/requested",
  "/setup",
]);

export const proxy = async (request: NextRequest) => {
  const { pathname } = request.nextUrl;

  // Probes must not depend on setup state or backend availability.
  if (isHealthProbePath(pathname)) {
    return NextResponse.next();
  }

  // Former Route Handler. GET must not clear the session (#655).
  if (pathname === "/logout") {
    return new NextResponse("Not Found", { status: 404 });
  }

  if (pathname === "/setup") {
    return NextResponse.next();
  }

  // The saved default locale rides along on the read the routing decision needs
  // anyway, and every response below carries it to the browser: it is the only
  // way `<html lang>` and the client error boundary get to name the language the
  // platform saved rather than the one the visitor's browser asked for.
  const { completed: setupCompleted, defaultLocale } =
    await resolveSetupState();
  const withLocale = (response: NextResponse) =>
    applyResolvedLocaleCookie(request, response, defaultLocale);

  if (!setupCompleted && pathname === "/login") {
    return withLocale(NextResponse.redirect(new URL("/setup", request.url)));
  }

  const sessionCookie = request.cookies.get(
    PLATFORM_SESSION_COOKIE_NAME
  )?.value;
  const hasStoredSessionCookie = Boolean(sessionCookie?.trim());

  if (PUBLIC_PATHS.has(pathname)) {
    const response = NextResponse.next();
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
    return withLocale(
      NextResponse.next({ request: { headers: requestHeaders } })
    );
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
  matcher: [
    "/((?!api/v1/revalidate(?:/|$)|_next/static|_next/image|favicon.ico).*)",
  ],
};
