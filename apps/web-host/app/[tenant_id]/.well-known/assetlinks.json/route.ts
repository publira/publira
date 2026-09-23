import type { NextRequest } from "next/server";

import {
  respondWithMobileAppAssociation,
  toAssetLinks,
} from "#lib/mobile-app-association";

export const GET = async (
  _request: NextRequest,
  { params }: RouteContext<"/[tenant_id]/.well-known/assetlinks.json">
) =>
  respondWithMobileAppAssociation(await params, ({ android }) =>
    android ? toAssetLinks(android) : undefined
  );
