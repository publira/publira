import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ADMIN_SESSION_COOKIE_NAME,
  buildLoginUrl,
} from "./lib/admin-auth-shared";

const PUBLIC_PATHS = new Set(["/login", "/logout", "/healthz"]);

export const proxy = (request: NextRequest) => {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const sessionId = request.cookies
    .get(ADMIN_SESSION_COOKIE_NAME)
    ?.value?.trim();
  if (sessionId) {
    return NextResponse.next();
  }

  return NextResponse.redirect(buildLoginUrl(request.nextUrl));
};

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
