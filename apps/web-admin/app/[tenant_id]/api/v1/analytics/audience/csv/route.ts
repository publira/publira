import { searchParamEnum } from "@publira/utils/search-params";

import {
  notFound,
  searchParamsOf,
  statsCsvQuerySchema,
  statsCsvResponse,
  tenantIdSchema,
} from "../../_lib/stats-csv-response";

const audienceCsvQuerySchema = statsCsvQuerySchema.extend({
  group: searchParamEnum(["day", "series"], { fallback: "day" }),
});

/** The Audience screen's table over a period, as a CSV attachment. */
export const GET = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/analytics/audience/csv">
) => {
  const { tenant_id } = await params;
  const tenantId = tenantIdSchema.safeParse(tenant_id);
  const query = audienceCsvQuerySchema.safeParse(searchParamsOf(request));
  if (!(tenantId.success && query.success)) {
    return notFound();
  }

  const { from, group, to } = query.data;
  return statsCsvResponse(
    tenantId.data,
    { group, kind: "audience" },
    { end: to, start: from }
  );
};
