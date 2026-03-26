import {
  createPublicGrpcApiClient,
  createTenantPublicIdResolver,
  PUBLIC_SESSION_COOKIE_NAME,
} from "@publira/public-web-shared";
import { getTenantDomainCandidates } from "@publira/utils";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const publicApiClient = createPublicGrpcApiClient();
const resolveTenantPublicId = createTenantPublicIdResolver(publicApiClient);

export const proxy = async (request: NextRequest): Promise<NextResponse> => {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(
    request.cookies.get(PUBLIC_SESSION_COOKIE_NAME)?.value
  );

  if (hasSession && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/my", request.url));
  }

  if (pathname === "/healthz") {
    return NextResponse.next();
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
