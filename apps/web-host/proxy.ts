import {
  PUBLIC_SESSION_COOKIE_NAME,
  createPublicGrpcApiClient,
  createTenantPublicIdResolver,
} from "@publira/public-web-shared";
import { getTenantDomainCandidates } from "@publira/utils";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { buildLoginUrl } from "./lib/auth-shared";

const publicApiClient = createPublicGrpcApiClient();
const resolveTenantPublicId = createTenantPublicIdResolver(publicApiClient);

const MEMBER_PATH_PREFIXES = ["/my", "/notifications", "/settings"] as const;
const GUEST_ONLY_PATHS = new Set(["/login", "/signup"]);

const isMemberPath = (pathname: string): boolean =>
  MEMBER_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

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

  const hasSessionCookie = Boolean(
    request.cookies.get(PUBLIC_SESSION_COOKIE_NAME)?.value?.trim()
  );

  if (hasSessionCookie && GUEST_ONLY_PATHS.has(pathname)) {
    return NextResponse.redirect(new URL("/my", request.url));
  }

  if (!hasSessionCookie && isMemberPath(pathname)) {
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
  return NextResponse.rewrite(url);
};

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
