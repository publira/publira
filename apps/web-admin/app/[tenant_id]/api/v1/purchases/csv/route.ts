import { searchParamDate } from "@publira/utils/search-params";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { z } from "zod";

import { buildLoginPath } from "#lib/admin-auth-shared";
import { exportPurchases, purchasesHref } from "#lib/payment-reconciliation";
import { getTenantForSession } from "#lib/tenant-detail";
import { isTenantIdFormat } from "#lib/tenant-id-format";

/**
 * Both dates are required: the screen's link always spells out the period it
 * resolved, and a default resolved here could fall on other days than that.
 */
const exportQuerySchema = z.object({
  from: searchParamDate(),
  to: searchParamDate(),
});

const tenantIdSchema = z.string().trim().refine(isTenantIdFormat);

const notFound = () => new NextResponse("Not Found", { status: 404 });

/**
 * The purchases and refunds of a period as a CSV attachment, which the API
 * records in the audit log. A rejected session returns to **Purchases** over
 * the same period after login, because a download cannot be the page login
 * lands on.
 */
export const GET = async (
  request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/purchases/csv">
) => {
  const { tenant_id } = await params;
  const tenantId = tenantIdSchema.safeParse(tenant_id);

  const query = exportQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );

  if (!(tenantId.success && query.success)) {
    return notFound();
  }

  const period = { endDate: query.data.to, startDate: query.data.from };

  const [tenant, file] = await Promise.all([
    getTenantForSession(tenantId.data),
    exportPurchases(tenantId.data, period),
  ]);

  if (
    (!tenant.ok && tenant.requiresSignIn) ||
    (!file.ok && file.reason === "signedOut")
  ) {
    redirect(buildLoginPath(purchasesHref(period), { revoked: true }));
  }

  if (!(tenant.ok && file.ok)) {
    return notFound();
  }

  // `--` separates the two ends of an ISO 8601 interval where `/` cannot go.
  const fileName = `purchases-${tenant.tenant.publicId}-${period.startDate}--${period.endDate}.csv`;

  return new NextResponse(file.csv, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
};
