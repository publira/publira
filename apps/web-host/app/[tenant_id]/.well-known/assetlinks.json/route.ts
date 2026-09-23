import type { NextRequest } from "next/server";

import {
  respondWithMobileAppAssociation,
  toAssetLinks,
} from "#lib/mobile-app-association";

export const GET = async (
  _request: NextRequest,
  { params }: RouteContext<"/[tenant_id]/.well-known/assetlinks.json">
) => {
  const { tenant_id: tenantId } = await params;
  return respondWithMobileAppAssociation(tenantId, ({ android }) =>
    android ? toAssetLinks(android) : undefined
  );
};
