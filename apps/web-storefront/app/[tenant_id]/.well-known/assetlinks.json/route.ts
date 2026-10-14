import type { NextRequest } from "next/server";

import { respondWithAssetLinks } from "#lib/mobile-app-association";

export const GET = async (
  _request: NextRequest,
  { params }: RouteContext<"/[tenant_id]/.well-known/assetlinks.json">
) => respondWithAssetLinks(await params);
