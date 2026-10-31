import {
  searchParamDate,
  searchParamString,
} from "@publira/utils/search-params";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { z } from "zod";

import { buildAuditLogsPath, exportPlatformAuditLogs } from "#lib/audit-logs";
import { getPlatformCurrentOperator } from "#lib/auth";
import { buildLoginPath } from "#lib/auth-shared";
import { getPlatformTenant } from "#lib/tenants";

/**
 * Both days are required: the screen's link always spells out the period it
 * resolved, and a default resolved here could fall on other days than that.
 * A filter the link leaves out is absent rather than empty, so an empty one is
 * refused instead of quietly widening the file.
 */
const exportQuerySchema = z.object({
  action: searchParamString().optional(),
  actor_user_public_id: searchParamString().optional(),
  created_from: searchParamDate(),
  created_to: searchParamDate(),
  tenant_id: searchParamString().optional(),
});

const notFound = () => new NextResponse("Not Found", { status: 404 });

/**
 * The platform's audit log over a period, narrowed by the list's filters, as
 * a CSV attachment. A session the API rejects returns to the list it was
 * downloaded from after login, because a download cannot be the page login
 * lands on.
 */
export const GET = async (request: Request) => {
  const query = exportQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );

  if (!query.success) {
    return notFound();
  }

  const filters = {
    action: query.data.action ?? "",
    actorUserPublicId: query.data.actor_user_public_id ?? "",
    createdFrom: query.data.created_from,
    createdTo: query.data.created_to,
    tenantPublicId: query.data.tenant_id ?? "",
  };

  const loginPath = buildLoginPath(buildAuditLogsPath(filters), {
    revoked: true,
  });

  let tenantId = "";

  if (filters.tenantPublicId) {
    // The tenant lookup checks the session too, but a rejected one would come
    // back to this download after login rather than to the list.
    const operator = await getPlatformCurrentOperator();

    if (!operator.ok && operator.requiresSignIn) {
      redirect(loginPath);
    }

    const tenant = await getPlatformTenant(filters.tenantPublicId);

    if (!(tenant.ok && tenant.tenant)) {
      return notFound();
    }

    tenantId = tenant.tenant.id;
  }

  const file = await exportPlatformAuditLogs({
    action: filters.action,
    actorUserPublicId: filters.actorUserPublicId,
    end: filters.createdTo,
    start: filters.createdFrom,
    tenantId,
  });

  if (!file.ok) {
    if (file.reason === "signedOut") {
      redirect(loginPath);
    }

    return notFound();
  }

  // `--` separates the two ends of an ISO 8601 interval where `/` cannot go.
  const fileName = `platform-audit-log-${filters.createdFrom}--${filters.createdTo}.csv`;

  return new NextResponse(file.csv, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
};
