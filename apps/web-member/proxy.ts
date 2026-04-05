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

const redirectToLogin = (request: NextRequest) =>
  NextResponse.redirect(buildLoginUrl(request.nextUrl));

const serviceUnavailableResponse = () =>
  new NextResponse("Service Unavailable", {
    headers: { "Retry-After": "30" },
    status: 503,
  });

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
    return redirectToLogin(request);
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

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-publira-session-id", sessionId);

  return NextResponse.rewrite(url, {
    request: {
      headers: requestHeaders,
    },
  });
};

export const config = {
  matcher: ["/((?!web-member-assets/|_next/static|_next/image|favicon.ico).*)"],
};
