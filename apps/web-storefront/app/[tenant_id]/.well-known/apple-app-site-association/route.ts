import type { NextRequest } from "next/server";

import { respondWithAppleAppSiteAssociation } from "#lib/mobile-app-association";

export const GET = async (
  _request: NextRequest,
  {
    params,
  }: RouteContext<"/[tenant_id]/.well-known/apple-app-site-association">
) => respondWithAppleAppSiteAssociation(await params);
