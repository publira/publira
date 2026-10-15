import { NextResponse } from "next/server";

import { tenantIdSchema } from "#lib/auth-input";
import {
  requirePublicSession,
  withPublicSessionReauth,
} from "#lib/auth-session";
import { listAllMyPurchases } from "#lib/purchases";
import { getTenantDefaultLocale } from "#lib/tenant";

import { renderPurchasesCsv } from "./_lib/purchases-csv";

/** Where a reader who has to sign in first is sent back to. */
const LIBRARY_PATH = "/my/library";

/**
 * The signed-in reader's whole purchase history as a CSV attachment, linked
 * from the library.
 *
 * A Route Handler has no locale segment, so a reader who has to sign in or
 * agree to the tenant's terms first is sent to that screen in the tenant's
 * default language, and comes back to the library rather than to a download.
 */
export const GET = async (
  _request: Request,
  { params }: RouteContext<"/[tenant_id]/api/v1/my/purchases/csv">
) => {
  const { tenant_id } = await params;
  const tenant = tenantIdSchema.safeParse(tenant_id);
  if (!tenant.success) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const tenantId = tenant.data;
  const locale = await getTenantDefaultLocale(tenantId);
  const accessToken = await requirePublicSession(
    locale,
    LIBRARY_PATH,
    tenantId
  );
  const purchases = await withPublicSessionReauth(
    locale,
    LIBRARY_PATH,
    () => listAllMyPurchases(tenantId, accessToken),
    tenantId
  );

  return new NextResponse(renderPurchasesCsv(purchases), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": 'attachment; filename="purchases.csv"',
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
};
