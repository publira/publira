import { getTenantDomainCandidates } from "@publira/utils";
import { isHealthProbePath } from "@publira/utils/health";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { apiClient } from "./lib/api-client";
import {
  buildLoginUrl,
  hasActivePublicSessionCookie,
  isSessionRevokedRedirect,
  PUBLIC_SESSION_COOKIE_NAME,
} from "./lib/auth-shared";
import { buildTenantRewritePathname } from "./lib/published-page-path";
import { createTenantIdResolver } from "./lib/tenant-resolution";

const resolveTenantId = createTenantIdResolver(apiClient);

// `/notifications` is the personal inbox. `/settings/notifications` is the
// email-preference screen and stays under `/settings`.
const MEMBER_PATH_PREFIXES = [
  "/my",
  "/announcements",
  "/notifications",
  "/settings",
] as const;
const GUEST_ONLY_PATHS = new Set(["/login", "/signup"]);

const isMemberPath = (pathname: string): boolean =>
  MEMBER_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

const redirectToLogin = (request: NextRequest, clearSession = false) => {
  const response = NextResponse.redirect(buildLoginUrl(request.nextUrl));
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

export const proxy = async (request: NextRequest): Promise<NextResponse> => {
  const { pathname } = request.nextUrl;

  // Probes must not depend on tenant resolution or backend availability.
  if (isHealthProbePath(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(PUBLIC_SESSION_COOKIE_NAME)?.value;
  const hasStoredSessionCookie = Boolean(sessionCookie?.trim());
  const hasSessionCookie = await hasActivePublicSessionCookie(sessionCookie);
  const isGuestOnlyPath = GUEST_ONLY_PATHS.has(pathname);

  // The API rejected this session while a page was rendering, where the cookie
  // cannot be touched. Clearing it here is what stops the guest-only rule below
  // from bouncing the reader back to the route that just rejected them.
  const isRejectedSession =
    isGuestOnlyPath && isSessionRevokedRedirect(request.nextUrl);

  if (hasSessionCookie && isGuestOnlyPath && !isRejectedSession) {
    return NextResponse.redirect(new URL("/my", request.url));
  }

  if (!hasSessionCookie && isMemberPath(pathname)) {
    return redirectToLogin(request, hasStoredSessionCookie);
  }

  const clearSession = isRejectedSession && hasStoredSessionCookie;

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

  const url = request.nextUrl.clone();
  // Single-segment published pages (admin slugs) rewrite to /page/[slug].
  url.pathname = buildTenantRewritePathname(tenantId, pathname);
  const response = NextResponse.rewrite(url);
  if (clearSession) {
    response.cookies.delete(PUBLIC_SESSION_COOKIE_NAME);
  }
  return response;
};

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
