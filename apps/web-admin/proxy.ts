import { getTenantDomainCandidates } from "@publira/utils";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ADMIN_SESSION_COOKIE_NAME,
  buildLoginUrl,
} from "./lib/admin-auth-shared";
import { resolveAdminTenantPublicId } from "./lib/admin-tenant";

const PUBLIC_PATHS = new Set(["/login", "/logout", "/healthz"]);

export const proxy = async (request: NextRequest) => {
  const { pathname } = request.nextUrl;

  if (pathname === "/healthz") {
    return NextResponse.next();
  }

  const tenantPublicId = await resolveAdminTenantPublicId(
    getTenantDomainCandidates(request.headers)
  );

  if (!tenantPublicId) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = `/${tenantPublicId}${pathname}`;

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
