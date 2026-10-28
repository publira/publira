import type { NextRequest } from "next/server";

import { openGraphCardResponse } from "#lib/open-graph-card";

import { parseGenreDetailParams } from "../../../(site)/genres/[genre_id]/_lib/search-params";

export const GET = async (
  _request: NextRequest,
  { params }: RouteContext<"/[tenant_id]/[locale]/og/genres/[genre_id]">
) => {
  const segments = await params;
  const genreId = parseGenreDetailParams(segments);
  return openGraphCardResponse(
    segments,
    genreId ? { genreId, kind: "genre" } : null
  );
};
