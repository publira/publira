import { searchParamEnum } from "@publira/utils/search-params";

import {
  notFound,
  searchParamsOf,
  statsCsvQuerySchema,
  statsCsvResponse,
  tenantIdSchema,
} from "../../_lib/stats-csv-response";

const revenueCsvQuerySchema = statsCsvQuerySchema.extend({
  group: searchParamEnum(["day", "series", "episode"], { fallback: "day" }),
});

/** The Revenue screen's table over a period, as a CSV attachment. */
export const GET = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/analytics/revenue/csv">
) => {
  const { tenant_id } = await params;
  const tenantId = tenantIdSchema.safeParse(tenant_id);
  const query = revenueCsvQuerySchema.safeParse(searchParamsOf(request));

  if (!(tenantId.success && query.success)) {
    return notFound();
  }

  const { from, group, to } = query.data;

  return statsCsvResponse(
    tenantId.data,
    { group, kind: "revenue" },
    { end: to, start: from }
  );
};
