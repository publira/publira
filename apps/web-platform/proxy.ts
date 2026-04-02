import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { PLATFORM_SESSION_COOKIE_NAME, buildLoginUrl } from "./lib/auth-shared";
import { isSetupCompleted } from "./lib/setup";

const PUBLIC_PATHS = new Set([
  "/confirm-email",
  "/login",
  "/logout",
  "/healthz",
  "/setup",
]);

export const proxy = async (request: NextRequest) => {
  const { pathname } = request.nextUrl;

  if (pathname === "/setup") {
    return NextResponse.next();
  }

  const setupCompleted = await isSetupCompleted();

  if (!setupCompleted && pathname === "/login") {
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const sessionId = request.cookies
    .get(PLATFORM_SESSION_COOKIE_NAME)
    ?.value?.trim();
  if (sessionId) {
    return NextResponse.next();
  }

  if (!setupCompleted) {
    return NextResponse.redirect(new URL("/setup", request.url));
  }

  return NextResponse.redirect(buildLoginUrl(request.nextUrl));
};

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
