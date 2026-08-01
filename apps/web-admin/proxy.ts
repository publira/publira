import { getTenantDomainCandidates } from "@publira/utils";
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
  "/login",
  "/logout",
  "/healthz",
]);

const serviceUnavailableResponse = () =>
  new NextResponse("Service Unavailable", {
    headers: { "Retry-After": "30" },
    status: 503,
  });

export const proxy = async (request: NextRequest) => {
  const { pathname } = request.nextUrl;

  if (pathname === "/healthz") {
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

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
