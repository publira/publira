import { getTenantDomainCandidates } from "@publira/utils";
import { isHealthProbePath } from "@publira/utils/health";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ADMIN_SESSION_COOKIE_NAME,
  buildLoginUrl,
} from "./lib/admin-auth-shared";
import { resolveTenantId } from "./lib/tenant";

const LEGACY_ANNOUNCEMENTS_PREFIX = "/notifications";

const PUBLIC_PATHS = new Set([
  "/accept-invite",
  "/confirm-email",
  "/confirm-password",
  "/forgot-password",
  "/livez",
  "/login",
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

  if (
    pathname === LEGACY_ANNOUNCEMENTS_PREFIX ||
    pathname.startsWith(`${LEGACY_ANNOUNCEMENTS_PREFIX}/`)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = `/announcements${pathname.slice(LEGACY_ANNOUNCEMENTS_PREFIX.length)}`;
    return NextResponse.redirect(url);
  }

  let tenantId: string | null;
  try {
    tenantId = await resolveTenantId(
      getTenantDomainCandidates(request.headers)
    );
  } catch {
    return serviceUnavailableResponse();
  }

  if (!tenantId) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = `/${tenantId}${pathname}`;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.rewrite(rewriteUrl);
  }

  const sessionId = request.cookies
    .get(ADMIN_SESSION_COOKIE_NAME)
    ?.value?.trim();
  if (sessionId) {
    return NextResponse.rewrite(rewriteUrl);
  }

  return NextResponse.redirect(buildLoginUrl(request.nextUrl));
};

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
