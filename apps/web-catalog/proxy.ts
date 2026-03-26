import {
  createPublicGrpcApiClient,
  createTenantPublicIdResolver,
} from "@publira/public-web-shared";
import { getTenantDomainCandidates } from "@publira/utils";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const publicApiClient = createPublicGrpcApiClient();
const resolveTenantPublicId = createTenantPublicIdResolver(publicApiClient);

export const proxy = async (request: NextRequest): Promise<NextResponse> => {
  const { pathname } = request.nextUrl;

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
  matcher: [
    "/((?!web-catalog-assets/|_next/static|_next/image|favicon.ico).*)",
  ],
};
