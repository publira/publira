import { routeParamString } from "@publira/utils/route-params";
import { z } from "zod";

import {
  notFound,
  searchParamsOf,
  statsCsvQuerySchema,
  statsCsvResponse,
  tenantIdSchema,
} from "../../../../_lib/stats-csv-response";

const dropOffPathSchema = z.object({
  episode_id: routeParamString(),
  series_id: routeParamString(),
  tenant_id: tenantIdSchema,
});

/** One episode's drop-off over a period, as a CSV attachment. */
export const GET = async (
  request: Request,
  {
    params,
  }: RouteContext<"/[tenant_id]/api/v1/analytics/episodes/[series_id]/[episode_id]/csv">
) => {
  const path = dropOffPathSchema.safeParse(await params);
  const query = statsCsvQuerySchema.safeParse(searchParamsOf(request));
  if (!(path.success && query.success)) {
    return notFound();
  }

  return statsCsvResponse(
    path.data.tenant_id,
    {
      episodePublicId: path.data.episode_id,
      kind: "drop_off",
      seriesPublicId: path.data.series_id,
    },
    { end: query.data.to, start: query.data.from }
  );
};
