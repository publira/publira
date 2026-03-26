import {
  createPublicGrpcApiClient,
  createTenantPublicIdResolver,
} from "@publira/public-web-shared";
import { getTenantDomainCandidates } from "@publira/utils";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { PUBLIC_SESSION_COOKIE_NAME, buildLoginUrl } from "./lib/auth-shared";

const publicApiClient = createPublicGrpcApiClient();
const resolveTenantPublicId = createTenantPublicIdResolver(publicApiClient);

export const proxy = async (request: NextRequest): Promise<NextResponse> => {
  const { pathname } = request.nextUrl;

  if (pathname === "/healthz") {
    return NextResponse.next();
  }

  // Check for session cookie
  const sessionId = request.cookies
    .get(PUBLIC_SESSION_COOKIE_NAME)
    ?.value?.trim();

  if (!sessionId) {
    // Redirect to login if no session
    return NextResponse.redirect(buildLoginUrl(request.nextUrl));
  }

  const tenantPublicId = await resolveTenantPublicId(
    getTenantDomainCandidates(request.headers)
  );

  if (!tenantPublicId) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${tenantPublicId}${pathname}`;
  return NextResponse.rewrite(url);
};

export const config = {
  matcher: ["/((?!web-member-assets/|_next/static|_next/image|favicon.ico).*)"],
};
