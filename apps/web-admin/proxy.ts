import { getTenantDomainCandidates } from "@publira/utils";
import { isHealthProbePath } from "@publira/utils/health";
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
import { resolveTenantId } from "./lib/tenant";

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
    return response;
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
    return NextResponse.rewrite(rewriteUrl, {
      request: { headers: requestHeaders },
    });
  }

  const response = NextResponse.redirect(buildLoginUrl(request.nextUrl));
  // A cookie that no longer decrypts or has run out is not worth carrying to
  // the login page, where it would only be rejected again.
  if (hasStoredSessionCookie) {
    response.cookies.delete(ADMIN_SESSION_COOKIE_NAME);
  }
  return response;
};

export const config = {
  matcher: [
    "/((?!api/v1/revalidate(?:/|$)|_next/static|_next/image|favicon.ico).*)",
  ],
};
