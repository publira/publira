import { createPublicApiClient } from "@publira/api-client/public/client";
import { getTenantDomainCandidates } from "@publira/utils";
import { LRUCache } from "lru-cache";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

// gRPC transport is used for internal Next.js → Go API communication
const publicApiClient = createPublicApiClient({
  baseUrl: process.env.PUBLIRA_PUBLIC_GRPC_URL ?? "http://localhost:8100",
  transport: "grpc",
});

const tenantCache = new LRUCache<string, { tenantPublicId: string | null }>({
  max: 500,
  ttl: 300_000,
});

const resolveTenantPublicId = async (
  domainCandidates: readonly string[]
): Promise<string | null> => {
  if (domainCandidates.length === 0) {
    return null;
  }

  const cacheKey = domainCandidates.join("\0");
  const cached = tenantCache.get(cacheKey);
  if (cached !== undefined) {
    return cached.tenantPublicId;
  }

  try {
    const response = await publicApiClient.auth.getTenantByDomain({
      domains: [...domainCandidates],
    });
    const tenantPublicId = response.tenantPublicId?.trim() || null;
    tenantCache.set(cacheKey, { tenantPublicId });
    return tenantPublicId;
  } catch {
    return null;
  }
};

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
