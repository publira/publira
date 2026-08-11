import { getTenantDomainCandidates } from "@publira/utils";
import { isHealthProbePath } from "@publira/utils/health";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ADMIN_SESSION_COOKIE_NAME,
  buildLoginUrl,
} from "./lib/admin-auth-shared";
import { resolveTenantId } from "./lib/tenant";

const PUBLIC_PATHS = new Set([
  "/accept-invite",
  "/confirm-email",
  "/confirm-password",
  "/forgot-password",
  "/livez",
  "/login",
  "/logout",
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

/**
 * Skip proxy for static asset paths that must not trigger tenant resolution.
 *
 * Role split with `app/global-not-found.tsx` and `app/favicon.ico` (#646):
 * - This matcher keeps `_next/*` and `favicon.ico` out of domain → tenant RPC.
 * - `app/favicon.ico` is a real metadata file so `/favicon.ico` never lands on
 *   `[tenant_id]` as a fake segment.
 * - `global-not-found.tsx` answers URLs that match no route at all, without
 *   entering the tenant layout tree (and without any tenant RPC).
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
