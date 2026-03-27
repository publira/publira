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

const serviceUnavailableResponse = () =>
  new NextResponse("Service Unavailable", {
    status: 503,
    headers: { "Retry-After": "30" },
  });

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

  let tenantPublicId: string | null;
  try {
    tenantPublicId = await resolveTenantPublicId(
      getTenantDomainCandidates(request.headers)
    );
  } catch {
    return serviceUnavailableResponse();
  }

  if (!tenantPublicId) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${tenantPublicId}${pathname}`;
  return NextResponse.rewrite(url);
};

export const config = {
  matcher: ["/((?!web-auth-assets/|_next/static|_next/image|favicon.ico).*)"],
};
