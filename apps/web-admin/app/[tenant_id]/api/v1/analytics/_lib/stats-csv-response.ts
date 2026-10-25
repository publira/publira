import { searchParamDate } from "@publira/utils/search-params";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { z } from "zod";

import { buildLoginPath } from "#lib/admin-auth-shared";
import { exportStats, statsReportHref } from "#lib/engagement";
import type { StatsExportReport, StatsPeriodRequest } from "#lib/engagement";
import { getTenantForSession } from "#lib/tenant-detail";
import { isTenantIdFormat } from "#lib/tenant-id-format";

/**
 * The query every analytics download takes. Both dates are required: the
 * screen's link always spells out the period it showed, and a default resolved
 * here could fall on other days than the screen's did.
 */
export const statsCsvQuerySchema = z.object({
  from: searchParamDate(),
  to: searchParamDate(),
});

export const tenantIdSchema = z.string().trim().refine(isTenantIdFormat);

export const notFound = () => new NextResponse("Not Found", { status: 404 });

/** The request's query as the plain record the search-param schemas read. */
export const searchParamsOf = (request: Request): Record<string, string> =>
  Object.fromEntries(new URL(request.url).searchParams);

const statsFileName = (
  tenantPublicId: string,
  report: StatsExportReport,
  period: StatsPeriodRequest
): string => {
  // `--` separates the two ends of an ISO 8601 interval where `/` cannot go.
  const days = `${period.start}--${period.end}`;
  if (report.kind === "drop_off") {
    return `drop-off-${tenantPublicId}-${report.episodePublicId}-${days}.csv`;
  }
  return `${report.kind}-by-${report.group}-${tenantPublicId}-${days}.csv`;
};

/**
 * A report as a CSV attachment. A rejected session returns to the screen the
 * download was on after login, because a download cannot be the page login
 * lands on.
 */
export const statsCsvResponse = async (
  tenantId: string,
  report: StatsExportReport,
  period: StatsPeriodRequest
): Promise<NextResponse> => {
  const [tenant, file] = await Promise.all([
    getTenantForSession(tenantId),
    exportStats(tenantId, report, period),
  ]);
  if (
    (!tenant.ok && tenant.requiresSignIn) ||
    (!file.ok && file.reason === "signedOut")
  ) {
    redirect(
      buildLoginPath(statsReportHref(report, period), { revoked: true })
    );
  }
  if (!(tenant.ok && file.ok)) {
    return notFound();
  }

  const fileName = statsFileName(tenant.tenant.publicId, report, period);
  return new NextResponse(file.csv, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
};
