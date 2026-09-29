import { routeParamString } from "@publira/utils/route-params";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { z } from "zod";

import { buildLoginPath } from "#lib/admin-auth-shared";
import { exportRoyaltyStatement } from "#lib/royalties";
import { royaltyPeriodSchema } from "#lib/royalty-period";
import { getTenantForSession } from "#lib/tenant-detail";
import { isTenantIdFormat } from "#lib/tenant-id-format";

const exportPathSchema = z.object({
  period: routeParamString().pipe(royaltyPeriodSchema),
  tenantId: z.string().trim().refine(isTenantIdFormat),
});

const notFound = () => new NextResponse("Not Found", { status: 404 });

/**
 * A closed month's statement as a CSV attachment. A rejected session returns to
 * the statement after login, because a download cannot be the page login lands on.
 */
export const GET = async (
  _request: Request,
  {
    params,
  }: RouteContext<"/[tenant_id]/api/v1/royalties/statements/[period]/csv">
) => {
  const { period, tenant_id } = await params;
  const path = exportPathSchema.safeParse({ period, tenantId: tenant_id });
  if (!path.success) {
    return notFound();
  }

  const [tenant, statement] = await Promise.all([
    getTenantForSession(path.data.tenantId),
    exportRoyaltyStatement(path.data.tenantId, path.data.period),
  ]);
  if (
    (!tenant.ok && tenant.requiresSignIn) ||
    (!statement.ok && statement.reason === "signedOut")
  ) {
    redirect(
      buildLoginPath(`/royalties/statements/${path.data.period}`, {
        revoked: true,
      })
    );
  }
  if (!(tenant.ok && statement.ok)) {
    return notFound();
  }

  const fileName = `royalties-${tenant.tenant.publicId}-${path.data.period}.csv`;
  return new NextResponse(statement.csv, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
};
