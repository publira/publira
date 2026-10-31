import {
  searchParamDate,
  searchParamString,
} from "@publira/utils/search-params";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { z } from "zod";

import { buildLoginPath } from "#lib/admin-auth-shared";
import { auditLogsHref, exportAuditLogs } from "#lib/audit";
import { getTenantForSession } from "#lib/tenant-detail";
import { isTenantIdFormat } from "#lib/tenant-id-format";

/**
 * Both dates are required: the screen's link always spells out the period it
 * resolved, and a default resolved here could fall on other days than that.
 * A filter the link leaves out is absent rather than empty, so an empty one is
 * refused instead of quietly widening the file.
 */
const exportQuerySchema = z.object({
  action: searchParamString().optional(),
  actor: searchParamString().optional(),
  from: searchParamDate(),
  to: searchParamDate(),
});

const tenantIdSchema = z.string().trim().refine(isTenantIdFormat);

const notFound = () => new NextResponse("Not Found", { status: 404 });

/**
 * The audit log over a period, narrowed by the list's filters, as a CSV
 * attachment. A rejected session returns to the list it was downloaded from
 * after login, because a download cannot be the page login lands on.
 */
export const GET = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/audit-logs/csv">
) => {
  const { tenant_id } = await params;
  const tenantId = tenantIdSchema.safeParse(tenant_id);

  const query = exportQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );

  if (!(tenantId.success && query.success)) {
    return notFound();
  }

  const exported = {
    action: query.data.action ?? "",
    actor: query.data.actor ?? "",
    end: query.data.to,
    start: query.data.from,
  };

  const [tenant, file] = await Promise.all([
    getTenantForSession(tenantId.data),
    exportAuditLogs(tenantId.data, exported),
  ]);

  if (
    (!tenant.ok && tenant.requiresSignIn) ||
    (!file.ok && file.reason === "signedOut")
  ) {
    redirect(buildLoginPath(auditLogsHref(exported), { revoked: true }));
  }

  if (!(tenant.ok && file.ok)) {
    return notFound();
  }

  // `--` separates the two ends of an ISO 8601 interval where `/` cannot go.
  const fileName = `audit-log-${tenant.tenant.publicId}-${exported.start}--${exported.end}.csv`;

  return new NextResponse(file.csv, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
};
