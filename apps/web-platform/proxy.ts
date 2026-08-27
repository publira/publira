import { isHealthProbePath } from "@publira/utils/health";
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
import { isSetupCompleted } from "./lib/setup";

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

  const setupCompleted = await isSetupCompleted();

  if (!setupCompleted && pathname === "/login") {
    return NextResponse.redirect(new URL("/setup", request.url));
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
    return response;
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
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const response = setupCompleted
    ? NextResponse.redirect(buildLoginUrl(request.nextUrl))
    : NextResponse.redirect(new URL("/setup", request.url));
  // A cookie that no longer decrypts or has run out is not worth carrying to
  // the login page, where it would only be rejected again.
  if (hasStoredSessionCookie) {
    response.cookies.delete(PLATFORM_SESSION_COOKIE_NAME);
  }
  return response;
};

export const config = {
  matcher: ["/((?!api/revalidate(?:/|$)|_next/static|_next/image|favicon.ico).*)"],
};
