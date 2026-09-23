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
) => {
  const { tenant_id: tenantId } = await params;
  return respondWithMobileAppAssociation(tenantId, ({ ios }) =>
    ios ? toAppleAppSiteAssociation(ios) : undefined
  );
};
