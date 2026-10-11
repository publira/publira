import type { NextRequest } from "next/server";

import {
  respondWithMobileAppAssociation,
  toAppleAppSiteAssociation,
} from "#lib/mobile-app-association";

export const GET = async (
  _request: NextRequest,
  {
    params,
  }: RouteContext<"/[tenant_id]/.well-known/apple-app-site-association">
) =>
  respondWithMobileAppAssociation(await params, ({ ios }) =>
    ios ? toAppleAppSiteAssociation(ios) : undefined
  );
